import 'dotenv/config'; // runs via tsx like seed.ts — nothing else loads .env

import { readFileSync } from 'node:fs';

import { PrismaPg } from '@prisma/adapter-pg';
import { slugifyNawat } from '@nahuat/shared';

import { PrismaClient } from '../src/generated/prisma/client';
import { buildDatabaseUrl } from '../src/url';
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

const adapter = new PrismaPg({ connectionString: buildDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

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

function filePath(): string {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) {
    throw new Error('Usage: npm run db:import -- <export.json>');
  }
  return path;
}

async function main(): Promise<void> {
  const path = filePath();
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

  let entryCount = 0;
  let translationCount = 0;

  // One transaction. A restore that stops halfway leaves a dictionary that is
  // neither the old one nor the new one, and the operator has no way to tell
  // which rows made it — the situation this whole mechanism exists to avoid.
  await prisma.$transaction(async (tx) => {
    for (const entry of file.entries) {
      // Publication state comes from the file, not forced true as in seed.ts.
      // A draft that was a draft when exported has to come back a draft, or a
      // restore publishes work that was deliberately unpublished.
      const record = await tx.entry.upsert({
        where: { nawatContent: entry.nawatContent },
        create: {
          nawatContent: entry.nawatContent,
          // Derived, not carried. The slug is a function of the headword, so
          // exporting it would be a second copy that could disagree with the
          // first — and slugifyNawat is the one definition of that function.
          slug: slugifyNawat(entry.nawatContent),
          type: entry.type,
          imageUrl: entry.imageUrl ?? null,
          isPublished: entry.isPublished,
          creatorId: author.id,
          updaterId: author.id,
        },
        update: {
          type: entry.type,
          imageUrl: entry.imageUrl ?? null,
          isPublished: entry.isPublished,
          updaterId: author.id,
        },
        select: { id: true },
      });
      entryCount += 1;

      for (const t of entry.translations) {
        await tx.translation.upsert({
          where: {
            entryId_dialectCode: { entryId: record.id, dialectCode: t.dialectCode },
          },
          create: {
            entryId: record.id,
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
          },
          // Every field, not just the two seed.ts updates. A re-import is meant
          // to bring rows back to the file's state; leaving a field out would
          // silently keep whatever the database had.
          update: {
            contentEs: t.contentEs,
            contentEn: t.contentEn ?? null,
            phonetic: t.phonetic ?? null,
            partOfSpeech: t.partOfSpeech ?? null,
            exampleNawat: t.exampleNawat ?? null,
            exampleEs: t.exampleEs ?? null,
            exampleEn: t.exampleEn ?? null,
            audioUrl: t.audioUrl ?? null,
            isPublished: t.isPublished,
            updaterId: author.id,
          },
        });
        translationCount += 1;
      }
    }
  });

  console.log(
    `imported ${entryCount} entries, ${translationCount} translations from ${path} ` +
      `(exported ${file.exportedAt} from ${file.source.database})`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
