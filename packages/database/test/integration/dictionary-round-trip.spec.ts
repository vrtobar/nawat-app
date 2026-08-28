import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaClient } from '../../src/generated/prisma/client';
import { createTestClient, TEST_DATABASE_URL } from './setup';

// The dictionary export and import, against a real Postgres.
//
// These paths were verified by hand against local Postgres and staging RDS on
// 2026-08-28, twice, because nothing else could verify them: the interesting
// behaviour is all in conditional writes — upsert branches, a raw UPDATE, an
// interactive transaction — which mocked Prisma cannot express. This suite is
// that ritual written down.

const prisma: PrismaClient = createTestClient();
const workDir = mkdtempSync(join(tmpdir(), 'nawat-integration-'));

function runScript(script: string, args: string[] = []): string {
  return execFileSync('npx', ['tsx', script, ...args], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Content only, and deliberately not row ids or timestamps: a restore creates
// new rows with new ids, so comparing those would fail on a correct restore.
// What must survive is what the file carries.
async function contentFingerprint(): Promise<string> {
  const rows = await prisma.$queryRaw<{ fp: string | null }[]>`
    SELECT md5(string_agg(x, '|' ORDER BY x)) AS fp
    FROM (
      SELECT e.nawat_content || e.slug || e.type || e.is_published
           || coalesce(e.image_url, '')
           || coalesce(t.dialect_code, '') || coalesce(t.content_es, '')
           || coalesce(t.content_en, '') || coalesce(t.phonetic, '')
           || coalesce(t.part_of_speech::text, '') || coalesce(t.example_nawat, '')
           || coalesce(t.example_es, '') || coalesce(t.example_en, '')
           || coalesce(t.audio_url, '') || coalesce(t.is_published::text, '') AS x
      FROM entries e
      LEFT JOIN translations t ON t.entry_id = e.id
      WHERE e.deleted_at IS NULL
    ) s
  `;
  return rows[0]?.fp ?? 'empty';
}

async function wipeContent(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM translations`;
  await prisma.$executeRaw`DELETE FROM entries`;
}

beforeEach(async () => {
  await wipeContent();
  runScript('prisma/seed.ts', ['--dev']);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('dictionary export and import', () => {
  it('restores a wiped database to an identical content fingerprint', async () => {
    const file = join(workDir, 'round-trip.json');
    const before = await contentFingerprint();
    expect(before).not.toBe('empty');

    runScript('prisma/export.ts', ['--out', file]);
    await wipeContent();
    expect(await prisma.entry.count()).toBe(0);

    runScript('prisma/import.ts', [file]);

    expect(await contentFingerprint()).toBe(before);
  });

  it('is idempotent — importing the same file twice changes nothing', async () => {
    const file = join(workDir, 'idempotent.json');
    runScript('prisma/export.ts', ['--out', file]);

    runScript('prisma/import.ts', [file]);
    const once = await contentFingerprint();
    runScript('prisma/import.ts', [file]);

    expect(await contentFingerprint()).toBe(once);
  });

  it('brings drifted rows back to the state in the file', async () => {
    // The UPDATE branch, which a fingerprint over clean data never reaches.
    // Every field here is one the raw UPDATE names, including a NULLed one:
    // clearing a column and restoring it is the case a naive `SET` misses.
    const file = join(workDir, 'drift.json');
    runScript('prisma/export.ts', ['--out', file]);
    const before = await contentFingerprint();

    await prisma.$executeRaw`
      UPDATE entries SET is_published = false, type = 'PHRASE'
      WHERE nawat_content = 'takat'
    `;
    await prisma.$executeRaw`
      UPDATE translations SET content_es = 'WRONG', phonetic = NULL
      WHERE entry_id = (SELECT id FROM entries WHERE nawat_content = 'takat')
    `;
    expect(await contentFingerprint()).not.toBe(before);

    runScript('prisma/import.ts', [file]);

    expect(await contentFingerprint()).toBe(before);
  });

  it('preserves publication state, so a draft comes back a draft', async () => {
    // seed.ts forces every row published; import must not. Exported as a
    // draft, restored as a draft.
    const file = join(workDir, 'draft.json');
    await prisma.$executeRaw`
      UPDATE entries SET is_published = false WHERE nawat_content = 'takat'
    `;
    runScript('prisma/export.ts', ['--out', file]);
    await wipeContent();
    runScript('prisma/import.ts', [file]);

    const entry = await prisma.entry.findUnique({
      where: { nawatContent: 'takat' },
      select: { isPublished: true },
    });
    expect(entry?.isPublished).toBe(false);
  });

  it('records the database it actually read, not the ambient environment', async () => {
    // The provenance bug: the header was built from process.env.DB_*, so it
    // could name a database that was never opened. DB_NAME is set to a lie
    // here; the header must ignore it.
    const file = join(workDir, 'provenance.json');
    execFileSync('npx', ['tsx', 'prisma/export.ts', '--out', file], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DB_NAME: 'not-the-database' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const header = JSON.parse(readFileSync(file, 'utf8')) as {
      source: { database: string; serverAddress?: string };
    };
    expect(header.source.database).toBe('nahuat_test');
    expect(header.source.database).not.toBe('not-the-database');
  });
});

describe('import guards', () => {
  it('refuses a file whose counts disagree with its contents', async () => {
    const file = join(workDir, 'truncated.json');
    runScript('prisma/export.ts', ['--out', file]);

    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries: unknown[] };
    parsed.entries = parsed.entries.slice(0, 2); // header counts left untouched
    writeFileSync(file, JSON.stringify(parsed));

    expect(() => runScript('prisma/import.ts', [file])).toThrow(/short|truncated/i);
  });

  it('refuses a format version it does not recognise', async () => {
    const file = join(workDir, 'v99.json');
    runScript('prisma/export.ts', ['--out', file]);

    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { formatVersion: number };
    parsed.formatVersion = 99;
    writeFileSync(file, JSON.stringify(parsed));

    expect(() => runScript('prisma/import.ts', [file])).toThrow(/format version/i);
  });

  it('refuses to import when the dialects it references do not exist', async () => {
    const file = join(workDir, 'no-dialects.json');
    runScript('prisma/export.ts', ['--out', file]);

    // Content first: dialect_code is an FK from translations.
    await wipeContent();
    await prisma.$executeRaw`DELETE FROM dialects`;

    expect(() => runScript('prisma/import.ts', [file])).toThrow(/dialect/i);
  });
});
