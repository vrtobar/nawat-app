import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service';
import { assertSafeTarget, prisma } from './setup';

// Refresh-token rotation and reuse detection, against a real Postgres.
//
// refresh-token.service.spec.ts already covers this service with a mocked
// Prisma, and cannot cover the part that matters. Rotation's single-use
// property comes from a CONDITIONAL update — `where: { id, usedAt: null }`
// inside a transaction — and a mock returns whatever it was told to return
// regardless of what the row says. The behaviour under test is the database's,
// not the service's.

const config = {
  get: (key: string) => {
    const values: Record<string, string> = {
      REFRESH_TOKEN_ABSOLUTE_TTL_DAYS: '30',
      REFRESH_TOKEN_IDLE_TTL_DAYS: '14',
    };
    return values[key];
  },
} as unknown as ConfigService;

const service = new RefreshTokenService(config);

async function makeUser(subject: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { provider_subject: { provider: 'SEED', subject } },
    create: {
      provider: 'SEED',
      subject,
      email: `${subject}@nahuat.invalid`,
      name: subject,
      role: 'USER',
    },
    update: {},
    select: { id: true },
  });
  return user.id;
}

beforeAll(async () => {
  await assertSafeTarget();
});

beforeEach(async () => {
  await prisma.refreshToken.deleteMany({});
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({});
});

describe('rotation', () => {
  it('spends the presented token and issues a successor in the same family', async () => {
    const userId = await makeUser('rotation-basic');
    const first = await service.issue(userId);

    const { refreshToken: second } = await service.rotate(first);

    const rows = await prisma.refreshToken.findMany({
      where: { userId },
      select: { familyId: true, usedAt: true },
      orderBy: { createdAt: 'asc' },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].usedAt).not.toBeNull(); // spent
    expect(rows[1].usedAt).toBeNull(); // its successor
    expect(rows[0].familyId).toBe(rows[1].familyId); // one session
    expect(second).not.toBe(first);
  });

  it('refuses a token that does not exist', async () => {
    await expect(service.rotate('not-a-token')).rejects.toThrow();
  });
});

describe('reuse detection', () => {
  it('revokes the entire family when a spent token is presented again', async () => {
    // The security-critical path. A spent token presented again is either a
    // replayed steal or a client racing itself; the OAuth 2.0 Security BCP
    // treats both as compromise and kills the session.
    const userId = await makeUser('reuse');
    const first = await service.issue(userId);
    const { refreshToken: second } = await service.rotate(first);

    await expect(service.rotate(first)).rejects.toThrow();

    const rows = await prisma.refreshToken.findMany({
      where: { userId },
      select: { revokedAt: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);

    // And the successor is dead too — the whole family, not just the replayed row.
    await expect(service.rotate(second)).rejects.toThrow();
  });
});

describe('concurrency', () => {
  it('lets exactly one of two simultaneous rotations of the same token win', async () => {
    // THE REASON THIS SUITE EXISTS. `where: { id, usedAt: null }` is what makes
    // rotation single-use: read-then-write would let both callers observe null
    // and both succeed, issuing two successors and leaving neither row marked
    // spent — so the reuse detection above could never fire afterwards.
    //
    // A mocked Prisma cannot express this at all: the conditional update either
    // matches a row or does not, and only a real database decides which.
    const userId = await makeUser('concurrent-rotate');
    const token = await service.issue(userId);

    const results = await Promise.allSettled([service.rotate(token), service.rotate(token)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser must not have left a successor behind. Two successors would
    // mean two live sessions from one rotation.
    const live = await prisma.refreshToken.count({
      where: { userId, usedAt: null, revokedAt: null },
    });
    expect(live).toBeLessThanOrEqual(1);
  });
});
