import { readFileSync } from 'node:fs';

import { slugifyNawat } from '@nahuat/shared';

import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { ExportFileSchema, FORMAT_VERSION } from './content-file';

// Restore a dictionary export produced by export.ts.
//
// SEPARATE COMMAND, NOT A SEED MODE, and deliberately so. seed.ts splits its
// two modes by command rather than by flag precisely so that no environment
// variable or argv typo can seed production from a fixture. Adding a
// "--from-file" branch there would reintroduce exactly the path that split
// exists to prevent. This is a different operation with a different guard: it
// takes an explicit file, and it refuses a format it does not recognise.
//
// IDEMPOTENT, AND ADDITIVE. Entries upsert on `nawatContent` and translations
// on (entry, dialect), so importing the same file twice changes nothing the
// second time and re-importing after edits brings rows back to the file's
// state. It does NOT delete: an entry present in the database but absent from
// the file is left alone. Restoring into an empty database — the case this was
// built for — makes the distinction moot, but importing into a populated one
// merges rather than replaces, and that is worth knowing before running it.
//
// The logic lives here rather than in import.ts so that it can be called with a
// caller-supplied PrismaClient. The integration suite needs that to observe the
// statements issued — the regression guard for the per-row version is a count
// of queries, which cannot be seen from outside a subprocess. import.ts is the
// CLI around this: it builds the client, reads argv, and reports.

// Attribution is flattened (content-file.ts), but Entry.creatorId and
// updaterId are non-null FKs with onDelete: Restrict — there is no anonymous
// content — so imported rows still need a User to point at.
//
// A synthetic row, mirroring seed.ts's SEED_AUTHOR: the IMPORT provider cannot
// collide with anything Google issues, since identity is the (provider,
// subject) PAIR, and `.invalid` is reserved by RFC 2606 so the address can
// never be delivered to.
//
// UNLIKE SEED_AUTHOR, THIS ROW CAN APPEAR IN PRODUCTION. That is the visible
// consequence of flattening attribution, and it is intended: content that
// arrived by restore is marked as such rather than being credited to whichever
// human happened to run the command. When provenance starts carrying real
// information — several contributors — that is the moment for format version 2,
// not for quietly attributing an import to an admin.
const IMPORT_AUTHOR = {
  provider: 'IMPORT',
  subject: 'restore',
  email: 'import@nahuat.invalid',
  name: 'Imported content',
  role: 'CONTRIBUTOR',
} as const;

export interface ImportResult {
  entryCount: number;
  translationCount: number;
  exportedAt: string;
  sourceDatabase: string;
}

export async function importFile(prisma: PrismaClient, path: string): Promise<ImportResult> {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));

  // Version first, and with its own message. A file from a future format would
  // otherwise fail as a wall of field-level errors that reads like corruption.
  const version = (raw as { formatVersion?: unknown }).formatVersion;
  if (version !== FORMAT_VERSION) {
    throw new Error(
      `${path} is format version ${String(version)}, this importer reads ${FORMAT_VERSION}. ` +
        `Refusing rather than importing part of it.`,
    );
  }

  const parsed = ExportFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`${path} does not match the export format:`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Invalid export file');
  }

  const file = parsed.data;

  // The counts in the header are the check on a truncated file. JSON.parse
  // catches a write cut mid-token; it does not catch one cut cleanly between
  // records, which is the failure that looks like success.
  const actualEntries = file.entries.length;
  const actualTranslations = file.entries.reduce((n, e) => n + e.translations.length, 0);
  if (actualEntries !== file.counts.entries || actualTranslations !== file.counts.translations) {
    throw new Error(
      `${path} is short: header declares ${file.counts.entries} entries and ` +
        `${file.counts.translations} translations, file contains ${actualEntries} and ` +
        `${actualTranslations}. Treating this as a truncated export.`,
    );
  }

  // Dialects are reference data and arrive through `db:seed`, which is safe in
  // every environment. Checked up front, before anything is written, so a fresh
  // database that has not been seeded fails with a sentence instead of a
  // foreign key violation partway through the restore.
  const dialectCodes = new Set((await prisma.dialect.findMany()).map((d) => d.code));
  if (dialectCodes.size === 0) {
    throw new Error('No dialects in this database. Run `npm run db:seed` first.');
  }
  for (const entry of file.entries) {
    for (const t of entry.translations) {
      if (!dialectCodes.has(t.dialectCode)) {
        throw new Error(
          `Unknown dialectCode "${t.dialectCode}" on "${entry.nawatContent}" — ` +
            `known: ${[...dialectCodes].join(', ')}. Run \`npm run db:seed\` first.`,
        );
      }
    }
  }

  const author = await prisma.user.upsert({
    where: {
      provider_subject: { provider: IMPORT_AUTHOR.provider, subject: IMPORT_AUTHOR.subject },
    },
    create: IMPORT_AUTHOR,
    update: {},
  });

  const entryCount = file.entries.length;
  const translationCount = file.entries.reduce((n, e) => n + e.translations.length, 0);

  // Batched, not row-by-row, and the reason is round trips rather than
  // elegance. The first version upserted each entry and each translation
  // individually: 91 statements for a 42-entry fixture, which finished inside
  // Prisma's default 5 s transaction timeout on a local socket and blew it at
  // 6201 ms through a bastion tunnel. Raising the timeout would have hidden
  // that, not fixed it — the cost is linear in rows, so a dictionary of 20,000
  // entries is ~40,000 round trips and tens of minutes with a write
  // transaction held open. This shape issues a FIXED number of statements per
  // chunk, so duration follows the size of the file rather than the latency of
  // the link.
  //
  // Prisma still owns id and updatedAt generation, which is why new rows go in
  // through createMany rather than a raw INSERT: `id` is `@default(cuid())` and
  // `updatedAt` is `@updatedAt`, both client-side, and neither column has a
  // database default. Generating cuids here would mean reimplementing their
  // spec to keep new ids indistinguishable from existing ones. Only the UPDATE
  // half is raw, because Prisma has no bulk update that varies values per row.
  const CHUNK = 500;

  await prisma.$transaction(
    async (tx) => {
      for (let i = 0; i < file.entries.length; i += CHUNK) {
        const chunk = file.entries.slice(i, i + CHUNK);
        const names = chunk.map((e) => e.nawatContent);

        const existing = await tx.entry.findMany({
          where: { nawatContent: { in: names } },
          select: { id: true, nawatContent: true },
        });
        const idByName = new Map(existing.map((e) => [e.nawatContent, e.id]));

        const toCreate = chunk.filter((e) => !idByName.has(e.nawatContent));
        const toUpdate = chunk.filter((e) => idByName.has(e.nawatContent));

        if (toCreate.length > 0) {
          await tx.entry.createMany({
            data: toCreate.map((e) => ({
              nawatContent: e.nawatContent,
              // Derived, not carried. The slug is a function of the headword,
              // so exporting it would be a second copy that could disagree.
              slug: slugifyNawat(e.nawatContent),
              type: e.type,
              imageUrl: e.imageUrl ?? null,
              isPublished: e.isPublished,
              creatorId: author.id,
              updaterId: author.id,
            })),
          });
        }

        if (toUpdate.length > 0) {
          // image_asset_id and deleted_at are absent on purpose: neither is in
          // the export format, so an UPDATE naming them would detach media and
          // undelete rows that a restore has no business touching. The media
          // itself is not exported at all — the assets bucket is in the
          // foundation layer and survives the teardown an export exists for.
          await tx.$executeRaw`
            UPDATE entries AS e
            SET type       = v.type::"EntryType",
                image_url  = v.image_url,
                is_published = v.is_published,
                updater_id = v.updater_id,
                updated_at = NOW()
            FROM (VALUES ${Prisma.join(
              toUpdate.map(
                (e) =>
                  Prisma.sql`(${e.nawatContent}::text, ${e.type}::text, ${
                    e.imageUrl ?? null
                  }::text, ${e.isPublished}::boolean, ${author.id}::text)`,
              ),
            )}) AS v(nawat_content, type, image_url, is_published, updater_id)
            WHERE e.nawat_content = v.nawat_content
          `;
        }

        // Re-read only what was created; the rest are already mapped.
        if (toCreate.length > 0) {
          const created = await tx.entry.findMany({
            where: { nawatContent: { in: toCreate.map((e) => e.nawatContent) } },
            select: { id: true, nawatContent: true },
          });
          for (const e of created) idByName.set(e.nawatContent, e.id);
        }

        // ---- translations for this chunk of entries ----
        const rows = chunk.flatMap((e) =>
          e.translations.map((t) => ({ ...t, entryId: idByName.get(e.nawatContent)! })),
        );
        if (rows.length === 0) continue;

        const entryIds = [...new Set(rows.map((r) => r.entryId))];
        const existingTx = await tx.translation.findMany({
          where: { entryId: { in: entryIds } },
          select: { entryId: true, dialectCode: true },
        });
        const seen = new Set(existingTx.map((t) => `${t.entryId}\u0000${t.dialectCode}`));

        const txCreate = rows.filter((r) => !seen.has(`${r.entryId}\u0000${r.dialectCode}`));
        const txUpdate = rows.filter((r) => seen.has(`${r.entryId}\u0000${r.dialectCode}`));

        if (txCreate.length > 0) {
          await tx.translation.createMany({
            data: txCreate.map((t) => ({
              entryId: t.entryId,
              dialectCode: t.dialectCode,
              contentEs: t.contentEs,
              contentEn: t.contentEn ?? null,
              phonetic: t.phonetic ?? null,
              partOfSpeech: t.partOfSpeech ?? null,
              exampleNawat: t.exampleNawat ?? null,
              exampleEs: t.exampleEs ?? null,
              exampleEn: t.exampleEn ?? null,
              audioUrl: t.audioUrl ?? null,
              isPublished: t.isPublished,
              creatorId: author.id,
              updaterId: author.id,
            })),
          });
        }

        // Every field the format carries, not a subset: a re-import is meant to
        // bring rows back to the file's state, and a column left out of the SET
        // silently keeps whatever the database had.
        for (let j = 0; j < txUpdate.length; j += CHUNK) {
          const part = txUpdate.slice(j, j + CHUNK);
          await tx.$executeRaw`
            UPDATE translations AS t
            SET content_es     = v.content_es,
                content_en     = v.content_en,
                phonetic       = v.phonetic,
                part_of_speech = v.part_of_speech::"PartOfSpeech",
                example_nawat  = v.example_nawat,
                example_es     = v.example_es,
                example_en     = v.example_en,
                audio_url      = v.audio_url,
                is_published   = v.is_published,
                updater_id     = v.updater_id,
                updated_at     = NOW()
            FROM (VALUES ${Prisma.join(
              part.map(
                (t) =>
                  Prisma.sql`(${t.entryId}::text, ${t.dialectCode}::text, ${
                    t.contentEs
                  }::text, ${t.contentEn ?? null}::text, ${t.phonetic ?? null}::text, ${
                    t.partOfSpeech ?? null
                  }::text, ${t.exampleNawat ?? null}::text, ${t.exampleEs ?? null}::text, ${
                    t.exampleEn ?? null
                  }::text, ${t.audioUrl ?? null}::text, ${t.isPublished}::boolean, ${
                    author.id
                  }::text)`,
              ),
            )}) AS v(entry_id, dialect_code, content_es, content_en, phonetic,
                     part_of_speech, example_nawat, example_es, example_en,
                     audio_url, is_published, updater_id)
            WHERE t.entry_id = v.entry_id AND t.dialect_code = v.dialect_code
          `;
        }
      }
    },
    // Generous, but no longer load-bearing: the statement count per chunk is
    // fixed, so this covers a slow link rather than a long queue of round trips.
    { timeout: 300_000, maxWait: 15_000 },
  );

  console.log(
    `imported ${entryCount} entries, ${translationCount} translations from ${path} ` +
      `(exported ${file.exportedAt} from ${file.source.database})`,
  );

  return {
    entryCount,
    translationCount,
    exportedAt: file.exportedAt,
    sourceDatabase: file.source.database,
  };
}
