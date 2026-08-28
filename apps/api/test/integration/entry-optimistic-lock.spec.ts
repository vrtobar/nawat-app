import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EntriesService } from '../../src/modules/dictionary/entries.service';
import { assertSafeTarget, prisma } from './setup';

// The entry editor's optimistic lock, against a real Postgres.
//
// `update()` matches `updatedAt` in the WHERE of a conditional update, so a row
// that moved between the read that filled the form and the write matches
// nothing. The service's own comment states the property outright — "THE
// CONDITIONAL UPDATE IS THE AUTHORITY, not the read above" — and nothing
// verified it, because a mocked Prisma returns the count it was told to return
// no matter what the row contains. Whether the WHERE matches is the database's
// decision, and this is the only place it can be observed.

const service = new EntriesService();
let dialectCode: string;
let authorId: string;

async function makeEntry(nawatContent: string): Promise<{ id: string; updatedAt: string }> {
  const entry = await prisma.entry.create({
    data: {
      nawatContent,
      slug: nawatContent,
      type: 'WORD',
      isPublished: false,
      creatorId: authorId,
      updaterId: authorId,
    },
    select: { id: true, updatedAt: true },
  });
  return { id: entry.id, updatedAt: entry.updatedAt.toISOString() };
}

beforeAll(async () => {
  await assertSafeTarget();

  const dialect = await prisma.dialect.findFirst({ select: { code: true } });
  if (!dialect) throw new Error('No dialects — run `npm run db:seed` against the test database.');
  dialectCode = dialect.code;

  const user = await prisma.user.upsert({
    where: { provider_subject: { provider: 'SEED', subject: 'optimistic-lock' } },
    create: {
      provider: 'SEED',
      subject: 'optimistic-lock',
      email: 'optimistic-lock@nahuat.invalid',
      name: 'Lock tester',
      role: 'CONTRIBUTOR',
    },
    update: {},
    select: { id: true },
  });
  authorId = user.id;
});

beforeEach(async () => {
  await prisma.translation.deleteMany({
    where: { entry: { nawatContent: { startsWith: 'lock-' } } },
  });
  await prisma.entry.deleteMany({ where: { nawatContent: { startsWith: 'lock-' } } });
});

afterAll(async () => {
  await prisma.entry.deleteMany({ where: { nawatContent: { startsWith: 'lock-' } } });
});

describe('optimistic lock', () => {
  it('accepts an update carrying the current updatedAt', async () => {
    const { id, updatedAt } = await makeEntry('lock-accepts');

    const result = await service.update(
      id,
      { expectedUpdatedAt: updatedAt, nawatContent: 'lock-accepts-renamed' },
      authorId,
      'CONTRIBUTOR',
      'es',
    );

    expect(result.nawatContent).toBe('lock-accepts-renamed');
  });

  it('refuses an update carrying a stale updatedAt', async () => {
    const { id, updatedAt } = await makeEntry('lock-stale');

    // Someone else saves first; the row moves.
    await service.update(
      id,
      { expectedUpdatedAt: updatedAt, nawatContent: 'lock-stale-first' },
      authorId,
      'CONTRIBUTOR',
      'es',
    );

    // The second editor still holds the timestamp from before that write.
    await expect(
      service.update(
        id,
        { expectedUpdatedAt: updatedAt, nawatContent: 'lock-stale-second' },
        authorId,
        'CONTRIBUTOR',
        'es',
      ),
    ).rejects.toThrow();

    // And the first write survived — the refusal is not a silent overwrite.
    const row = await prisma.entry.findUniqueOrThrow({
      where: { id },
      select: { nawatContent: true },
    });
    expect(row.nawatContent).toBe('lock-stale-first');
  });

  it('lets exactly one of two simultaneous edits win', async () => {
    // Both editors loaded the same version and save at the same moment. The
    // conditional update is what makes this safe: read-then-write would let
    // both observe the same updatedAt and both write, and the loser's change
    // would silently replace the winner's with no record that it happened.
    const { id, updatedAt } = await makeEntry('lock-concurrent');

    const results = await Promise.allSettled([
      service.update(
        id,
        { expectedUpdatedAt: updatedAt, nawatContent: 'lock-concurrent-a' },
        authorId,
        'CONTRIBUTOR',
        'es',
      ),
      service.update(
        id,
        { expectedUpdatedAt: updatedAt, nawatContent: 'lock-concurrent-b' },
        authorId,
        'CONTRIBUTOR',
        'es',
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // The surviving row is one of the two, not a blend of both.
    const row = await prisma.entry.findUniqueOrThrow({
      where: { id },
      select: { nawatContent: true },
    });
    expect(['lock-concurrent-a', 'lock-concurrent-b']).toContain(row.nawatContent);
  });

  it('refuses when the row was deleted after the caller read it', async () => {
    // Same failed conditional update, different cause. The service pays one
    // extra read on the failure path to tell a conflict from a deletion, and
    // the caller should get "not found" rather than "someone else edited it".
    const { id, updatedAt } = await makeEntry('lock-deleted');
    await prisma.entry.update({ where: { id }, data: { deletedAt: new Date() } });

    await expect(
      service.update(
        id,
        { expectedUpdatedAt: updatedAt, nawatContent: 'lock-deleted-x' },
        authorId,
        'CONTRIBUTOR',
        'es',
      ),
    ).rejects.toThrow();
  });
});
