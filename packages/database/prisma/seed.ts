import 'dotenv/config'; // db:seed runs tsx directly — nothing else loads .env

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CreateEntrySchema, CreateTranslationSchema } from '@nahuat/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';

import { PrismaClient } from '../src/generated/prisma/client';
import { buildDatabaseUrl } from '../src/url';
import { DIALECTS } from './seed-data/dialects';

// Same reason as prisma.config.ts: this runs as an ECS task too, where
// DATABASE_URL does not exist and the connection is assembled from DB_*.
const adapter = new PrismaPg({ connectionString: buildDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

// TWO MODES, SPLIT BY COMMAND RATHER THAN BY FLAG.
//
//   db:seed       reference data only — safe in every environment, and what
//                 the one-off ECS task runs.
//   db:seed:dev   reference data plus placeholder content, for local work.
//
// A flag would have been fewer lines. It is rejected because the seed task's
// command is overridden at RunTask time, so an environment variable or an
// argv typo is the only thing that would stand between production and a
// dictionary full of fake Nawat. A language preservation project cannot
// treat that as a low-severity mistake: wrong data that looks authoritative
// is worse than an empty table, because it gets copied outward.
//
// Anything reachable from `seedReference` must therefore be safe to apply to
// production, every time, forever.
const withDevContent = process.argv.includes('--dev');

// -----------------------------------------------------------------------------
// REFERENCE DATA
// -----------------------------------------------------------------------------

async function seedReference(): Promise<void> {
  for (const dialect of DIALECTS) {
    // Upsert on `code`, not `id`: code is the FK target every Translation
    // points at and the only stable identifier here. Re-running updates the
    // name and description without orphaning a single translation.
    await prisma.dialect.upsert({
      where: { code: dialect.code },
      create: dialect,
      update: {
        nameEs: dialect.nameEs,
        nameEn: dialect.nameEn,
        descriptionEs: dialect.descriptionEs,
        descriptionEn: dialect.descriptionEn,
      },
    });
  }

  console.log(`reference: ${DIALECTS.length} dialect(s)`);
}

// -----------------------------------------------------------------------------
// DEV CONTENT
// -----------------------------------------------------------------------------

// Composed from the shared schemas rather than restated, so this file cannot
// drift from the API contract. The only thing added here is the nesting —
// the API creates a translation against an existing entry via
// POST /entries/:entryId/translations, so no shared schema describes the two
// together.
const SeedEntrySchema = CreateEntrySchema.extend({
  translations: z.array(CreateTranslationSchema).min(1),
});

const SeedFileSchema = z.object({
  $comment: z.array(z.string()).optional(),
  entries: z.array(SeedEntrySchema),
});

// Attribution for placeholder content. Entry.creatorId and updaterId are
// non-null FKs with onDelete: Restrict, so seeded rows need a User to point
// at — there is no anonymous content.
//
// Synthetic and unmistakable on purpose. `seed|` is not an Auth0 connection
// prefix so it can never collide with a real `sub`, and `.invalid` is
// reserved by RFC 2606 so the address can never be delivered to. Created only
// on the dev path, so production never grows this row.
const SEED_AUTHOR = {
  auth0Id: 'seed|dev-content',
  email: 'seed@nahuat.invalid',
  name: 'Seed (placeholder content)',
  role: 'CONTRIBUTOR',
} as const;

async function seedDevContent(): Promise<void> {
  const path = join(__dirname, 'seed-data', 'dev-entries.json');
  const parsed = SeedFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));

  if (!parsed.success) {
    // Fail loudly and specifically. A seed that inserts a half-valid row is
    // worse than one that refuses: the bad row survives into every later
    // query and looks like real data.
    console.error('dev-entries.json does not match the API contract:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Invalid seed data');
  }

  const author = await prisma.user.upsert({
    where: { auth0Id: SEED_AUTHOR.auth0Id },
    create: SEED_AUTHOR,
    update: {},
  });

  const dialectCodes = new Set((await prisma.dialect.findMany()).map((d) => d.code));

  let entryCount = 0;
  let translationCount = 0;

  for (const entry of parsed.data.entries) {
    for (const t of entry.translations) {
      // The FK would catch this, but the error names a constraint rather than
      // the file and line that caused it.
      if (!dialectCodes.has(t.dialectCode)) {
        throw new Error(
          `Unknown dialectCode "${t.dialectCode}" on "${entry.nawatContent}" — ` +
            `known: ${[...dialectCodes].join(', ')}`,
        );
      }
    }

    // Published on purpose. entries_live_idx and translations_live_idx are
    // partial indexes over `is_published AND deleted_at IS NULL`, so
    // unpublished rows would leave them empty and the queries they exist for
    // untested. See 20260815160500_partial_live_indexes.
    const record = await prisma.entry.upsert({
      where: { nawatContent: entry.nawatContent },
      create: {
        nawatContent: entry.nawatContent,
        type: entry.type,
        isPublished: true,
        creatorId: author.id,
        updaterId: author.id,
      },
      update: { updaterId: author.id },
      select: { id: true },
    });
    entryCount += 1;

    for (const [index, t] of entry.translations.entries()) {
      // priority is explicit in the file rather than resolved here. The
      // service layer owns "next free priority per (entry, dialect)" once the
      // dictionary module exists; duplicating that rule in the seed would be
      // a second implementation of it, and the two would drift. Falling back
      // to file order keeps this honest about not being that logic.
      const priority = t.priority ?? index + 1;

      await prisma.translation.upsert({
        where: {
          entryId_dialectCode_priority: {
            entryId: record.id,
            dialectCode: t.dialectCode,
            priority,
          },
        },
        create: {
          entryId: record.id,
          dialectCode: t.dialectCode,
          priority,
          contentEs: t.contentEs,
          contentEn: t.contentEn ?? null,
          phonetic: t.phonetic ?? null,
          partOfSpeech: t.partOfSpeech ?? null,
          exampleNawat: t.exampleNawat ?? null,
          exampleEs: t.exampleEs ?? null,
          audioUrl: t.audioUrl ?? null,
          isPublished: true,
          creatorId: author.id,
          updaterId: author.id,
        },
        update: {
          contentEs: t.contentEs,
          contentEn: t.contentEn ?? null,
          updaterId: author.id,
        },
      });
      translationCount += 1;
    }
  }

  console.log(
    `dev content: ${entryCount} entries, ${translationCount} translations ` +
      `(PLACEHOLDER — not real Nawat)`,
  );
}

async function main(): Promise<void> {
  await seedReference();

  if (withDevContent) {
    await seedDevContent();
  } else {
    console.log('dev content: skipped (run `npm run db:seed:dev` to include it)');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
