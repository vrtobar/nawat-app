import 'dotenv/config'; // runs via tsx like seed.ts — nothing else loads .env

import { writeFileSync } from 'node:fs';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { buildDatabaseUrl } from '../src/url';
import { ExportFileSchema, FORMAT_VERSION } from './content-file';

// Dictionary export — entries and translations out of a database and into one
// JSON file.
//
// WHY THIS EXISTS. Production is disposable before launch (ADR 17) and RDS
// lives in the application layer, so tearing an environment down destroys its
// content. Anything authored through the editor lives only there until this
// runs.
//
// DELIBERATELY NOT A DATABASE BACKUP. Users, refresh tokens and audit rows are
// not exported. "The whole database" is a job for an RDS snapshot, which is
// block-level, consistent, and survives instance deletion. This is the portable
// half: the content, in a form that can be read, diffed, and restored into an
// environment that does not exist yet.
//
// NO ATTRIBUTION. See content-file.ts — content only, by choice, for now.
//
// S3 IS NOT THIS SCRIPT'S JOB. It writes a file; `aws s3 cp` puts it somewhere
// durable, and infra/scripts/dictionary-backup.sh does both with a consistent
// key layout. Uploading from here would mean an AWS SDK dependency in a package
// the API image installs, to save one line of shell.

const connectionString = buildDatabaseUrl();
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// --out <path>, or stdout when absent so the file can be piped or inspected
// without landing anywhere.
function outPath(): string | undefined {
  const i = process.argv.indexOf('--out');
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error('--out needs a file path');
  return value;
}

async function main(): Promise<void> {
  // Soft-deleted rows are left behind. They are not content any more, and
  // restoring them would resurrect entries someone deleted on purpose.
  const entries = await prisma.entry.findMany({
    where: { deletedAt: null },
    // Sorted so two exports of an unchanged database are byte-identical, which
    // is what makes the files diffable and keeps S3 versioning meaningful.
    orderBy: { nawatContent: 'asc' },
    select: {
      nawatContent: true,
      type: true,
      imageUrl: true,
      isPublished: true,
      translations: {
        where: { deletedAt: null },
        orderBy: { dialectCode: 'asc' },
        select: {
          dialectCode: true,
          contentEs: true,
          contentEn: true,
          phonetic: true,
          partOfSpeech: true,
          exampleNawat: true,
          exampleEs: true,
          exampleEn: true,
          audioUrl: true,
          isPublished: true,
        },
      },
    },
  });

  // Prisma returns null for an empty nullable column; the schemas describe
  // these fields as optional, so drop the nulls rather than widening every
  // field to nullable. An absent key and a null mean the same thing here —
  // there is no value — and the create schemas already say so.
  const dropNulls = <T extends object>(row: T): Partial<T> =>
    Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as Partial<T>;

  const payload = {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      database:
        process.env.DB_NAME ??
        new URL(connectionString ?? 'postgres://x/unknown').pathname.slice(1),
      host: process.env.DB_HOST ?? new URL(connectionString ?? 'postgres://unknown').hostname,
    },
    counts: {
      entries: entries.length,
      translations: entries.reduce((n, e) => n + e.translations.length, 0),
    },
    entries: entries.map((e) => ({
      ...dropNulls(e),
      translations: e.translations.map(dropNulls),
    })),
  };

  // Validated on the way OUT, not only on the way in. A file that cannot be
  // imported is worth discovering while the database it came from still
  // exists, rather than on the restore after a teardown.
  const parsed = ExportFileSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('Export does not match the export format:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Refusing to write an unreadable export');
  }

  const json = `${JSON.stringify(parsed.data, null, 2)}\n`;
  const out = outPath();

  if (out) {
    writeFileSync(out, json);
    console.error(
      `exported ${payload.counts.entries} entries, ` +
        `${payload.counts.translations} translations -> ${out}`,
    );
  } else {
    // Counts to stderr so stdout stays pure JSON and stays pipeable.
    process.stdout.write(json);
    console.error(
      `exported ${payload.counts.entries} entries, ${payload.counts.translations} translations`,
    );
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
