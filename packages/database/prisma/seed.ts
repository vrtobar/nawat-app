import 'dotenv/config'; // db:seed runs tsx directly — nothing else loads .env

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CreateEntrySchema, CreateTranslationSchema, slugifyNawat } from '@nahuat/shared';
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
//   db:seed:dev   reference data plus a curated sample of real vocabulary, for
//                 local work and the disposable staging environment.
//
// A flag would have been fewer lines. It is rejected because the seed task's
// command is overridden at RunTask time, so an environment variable or an
// argv typo is the only thing that would stand between production and a
// dictionary seeded from a fixture. The dev content is test data — real
// headwords with some fabricated data points (regional variants, examples),
// not authoritative Nawat (see dev-entries.json). Production content is not
// meant to arrive this way at all: it enters through the API, per row, with
// validation, audit logging and attribution to a real contributor.
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

// Attribution for the sample test content. Entry.creatorId and updaterId are
// non-null FKs with onDelete: Restrict, so seeded rows need a User to point
// at — there is no anonymous content. This content is a disposable test
// fixture applied in a batch, so it is attributed to this synthetic seeder;
// real vocabulary is entered later through the API, which is what carries
// individual authorship.
//
// Synthetic and unmistakable on purpose. `seed|` is not an Auth0 connection
// prefix so it can never collide with a real `sub`, and `.invalid` is
// reserved by RFC 2606 so the address can never be delivered to. Created only
// on the dev path, so production never grows this row.
const SEED_AUTHOR = {
  auth0Id: 'seed|dev-content',
  email: 'seed@nahuat.invalid',
  name: 'Seed (sample content)',
  role: 'CONTRIBUTOR',
} as const;

// -----------------------------------------------------------------------------
// DEV LOGIN USERS
// -----------------------------------------------------------------------------

// Accounts for hand-testing role-gated routes against a local mock OIDC issuer
// (docs/adr/0013). They are a companion to that issuer and useless without it:
// a User row grants nothing on its own, because authorization is read from the
// token, never from the database. Staging runs this same seed and is verified
// against the real Auth0 tenant, which will never mint a `seed|` subject — so
// the rows are inert there by construction.
//
// Same conventions as SEED_AUTHOR above, for the same reasons: `seed|` is not
// an Auth0 connection prefix so these can never collide with a real `sub`, and
// `.invalid` is reserved by RFC 2606 so the addresses can never be delivered
// to. Dev path only — seedReference must stay safe for production.
//
// `id` is set explicitly instead of letting @default(cuid()) generate it. The
// token's https://nahuat.com/userId claim has to match a real User.id, and a
// generated cuid is not known until seed time — pinning the ids is what lets
// tokens be minted offline, deterministically, with no database lookup.
// Entry.creatorId and Translation.creatorId are non-null FKs with
// onDelete: Restrict, so a token whose userId points at no row authenticates
// happily and then fails the first write on a foreign key violation.
//
// All three rungs of the ladder, not just ADMIN: @Roles is a ranked comparison
// (ADR 0013), so proving CONTRIBUTOR is refused a publish needs a CONTRIBUTOR
// token as much as proving ADMIN is allowed one needs an ADMIN token.
const DEV_USERS = [
  {
    id: 'dev_user_0000000000000000',
    auth0Id: 'seed|dev-user',
    email: 'dev-user@nahuat.invalid',
    name: 'Dev User (USER)',
    role: 'USER',
  },
  {
    id: 'dev_contributor_000000000',
    auth0Id: 'seed|dev-contributor',
    email: 'dev-contributor@nahuat.invalid',
    name: 'Dev User (CONTRIBUTOR)',
    role: 'CONTRIBUTOR',
  },
  {
    id: 'dev_admin_000000000000000',
    auth0Id: 'seed|dev-admin',
    email: 'dev-admin@nahuat.invalid',
    name: 'Dev User (ADMIN)',
    role: 'ADMIN',
  },
] as const;

async function seedDevUsers(): Promise<void> {
  for (const user of DEV_USERS) {
    // Upsert on auth0Id, matching how a real login resolves a user. `update`
    // carries role deliberately: changing a rung in this list should take
    // effect on a re-seed rather than silently keeping the old one.
    //
    // `id` is absent from `update` on purpose — it is a primary key that
    // Entry.creatorId and Translation.creatorId point at, so rewriting it
    // would strand existing attribution. On a new database this never
    // matters: no row matches, `create` runs, and the pinned id is used.
    const row = await prisma.user.upsert({
      where: { auth0Id: user.auth0Id },
      create: user,
      update: { email: user.email, name: user.name, role: user.role },
      select: { id: true },
    });

    // Which leaves one way to end up wrong: a row that already exists under
    // this auth0Id with some other id — a database seeded before these ids
    // were pinned, or a pinned id edited in the list above. The upsert would
    // report success while the id silently stayed stale, and the failure
    // would surface much later as a foreign key violation on the first write
    // by a token whose userId claim points at nothing. Refuse instead, and
    // say exactly how to fix it.
    if (row.id !== user.id) {
      throw new Error(
        `Dev user "${user.auth0Id}" exists with id "${row.id}", expected "${user.id}". ` +
          `Tokens minted for this user would fail on write. Delete the row and re-seed: ` +
          `DELETE FROM users WHERE auth0_id = '${user.auth0Id}';`,
      );
    }
  }

  console.log(
    `dev users: ${DEV_USERS.length} (${DEV_USERS.map((u) => u.role).join(', ')}) ` +
      `— local mock-issuer logins, dev/staging only`,
  );
}

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
        slug: slugifyNawat(entry.nawatContent),
        type: entry.type,
        isPublished: true,
        creatorId: author.id,
        updaterId: author.id,
      },
      update: { updaterId: author.id },
      select: { id: true },
    });
    entryCount += 1;

    for (const t of entry.translations) {
      // One translation per (entry, dialect) — the upsert key. Several senses of
      // a word live in a pipe-separated gloss on this row, not separate rows.
      await prisma.translation.upsert({
        where: {
          entryId_dialectCode: {
            entryId: record.id,
            dialectCode: t.dialectCode,
          },
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
      `(sample test data — dev/staging only)`,
  );
}

async function main(): Promise<void> {
  await seedReference();

  if (withDevContent) {
    await seedDevUsers();
    await seedDevContent();
  } else {
    console.log('dev users + content: skipped (run `npm run db:seed:dev` to include them)');
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
