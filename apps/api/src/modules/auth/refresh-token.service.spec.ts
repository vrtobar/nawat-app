import { createHash } from 'node:crypto';

import { prisma } from '@nahuat/database';
import { API_ERROR_CODES } from '@nahuat/shared';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config/env.validation';
import { RefreshTokenService } from './refresh-token.service';

vi.mock('@nahuat/database', () => ({
  prisma: {
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    // $transaction is handed an array of prepared operations. The mock resolves
    // them in order, which is enough to assert what was queued and in what
    // shape — see the note on what these tests cannot prove.
    $transaction: vi.fn(),
  },
}));

const refreshToken = vi.mocked(prisma.refreshToken);
const transaction = vi.mocked(prisma.$transaction);

const ABSOLUTE_DAYS = 30;
const IDLE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const config = {
  get: (key: keyof Env) => (key === 'REFRESH_TOKEN_ABSOLUTE_TTL_DAYS' ? ABSOLUTE_DAYS : IDLE_DAYS),
} as unknown as ConfigService<Env, true>;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const future = (days: number) => new Date(Date.now() + days * MS_PER_DAY);
const past = (days: number) => new Date(Date.now() - days * MS_PER_DAY);

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'rt_1',
  familyId: 'fam_1',
  userId: 'usr_1',
  familyExpiresAt: future(20),
  idleExpiresAt: future(10),
  usedAt: null,
  revokedAt: null,
  user: { isActive: true, deletedAt: null },
  ...overrides,
});

let service: RefreshTokenService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new RefreshTokenService(config);
  // The default: the conditional spend wins its race and the successor is
  // created. Tests that care override it.
  transaction.mockResolvedValue([{ count: 1 }, {}] as never);
});

describe('RefreshTokenService', () => {
  describe('issue', () => {
    it('stores only a hash, never the token', async () => {
      refreshToken.create.mockResolvedValue({} as never);

      const token = await service.issue('usr_1');

      const { data } = refreshToken.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };

      expect(data.tokenHash).toBe(hash(token));
      // The row must not carry the token in any field.
      expect(JSON.stringify(data)).not.toContain(token);
    });

    it('returns a token with 256 bits of entropy, and a different one each time', async () => {
      refreshToken.create.mockResolvedValue({} as never);

      const first = await service.issue('usr_1');
      const second = await service.issue('usr_1');

      // 32 bytes, base64url, unpadded.
      expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first).not.toBe(second);
    });

    it('opens a new family rather than joining one', async () => {
      refreshToken.create.mockResolvedValue({} as never);

      await service.issue('usr_1');
      await service.issue('usr_1');

      const familyOf = (call: number) =>
        (refreshToken.create.mock.calls[call]![0] as { data: { familyId: string } }).data.familyId;

      expect(familyOf(0)).not.toBe(familyOf(1));
    });

    it('sets the absolute and idle deadlines from configuration', async () => {
      refreshToken.create.mockResolvedValue({} as never);

      await service.issue('usr_1');

      const { data } = refreshToken.create.mock.calls[0]![0] as {
        data: { familyExpiresAt: Date; idleExpiresAt: Date };
      };

      const days = (d: Date) => Math.round((d.getTime() - Date.now()) / MS_PER_DAY);
      expect(days(data.familyExpiresAt)).toBe(ABSOLUTE_DAYS);
      expect(days(data.idleExpiresAt)).toBe(IDLE_DAYS);
    });
  });

  describe('rotate', () => {
    it('issues a successor in the same family, inheriting the absolute deadline', async () => {
      const familyExpiresAt = future(20);
      refreshToken.findUnique.mockResolvedValue(stored({ familyExpiresAt }) as never);

      const { userId, refreshToken: next } = await service.rotate('presented');

      // Whose session this is, for minting the replacement access token — read
      // from the stored row, never from anything the caller sent.
      expect(userId).toBe('usr_1');

      const queued = transaction.mock.calls[0]![0] as unknown as unknown[];
      const createArg = refreshToken.create.mock.calls[0]![0] as {
        data: { familyId: string; familyExpiresAt: Date; idleExpiresAt: Date; tokenHash: string };
      };

      expect(queued).toHaveLength(2);
      expect(createArg.data.familyId).toBe('fam_1');
      expect(createArg.data.tokenHash).toBe(hash(next));
      // INHERITED, not recomputed — otherwise a session refreshed often enough
      // would never reach its absolute deadline.
      expect(createArg.data.familyExpiresAt).toBe(familyExpiresAt);
      // The idle deadline, by contrast, resets.
      expect(Math.round((createArg.data.idleExpiresAt.getTime() - Date.now()) / MS_PER_DAY)).toBe(
        IDLE_DAYS,
      );
    });

    // The invariant the whole design rests on. Without `usedAt: null` in the
    // WHERE, two concurrent refreshes both succeed and neither is ever marked
    // reused, so the detection below could not fire at all.
    it('spends the presented token with a conditional update', async () => {
      refreshToken.findUnique.mockResolvedValue(stored() as never);

      await service.rotate('presented');

      expect(refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt_1', usedAt: null } }),
      );
    });

    it('looks the token up by hash, never by value', async () => {
      refreshToken.findUnique.mockResolvedValue(stored() as never);

      await service.rotate('presented');

      expect(refreshToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hash('presented') } }),
      );
    });

    it.each([
      ['unknown', null, undefined],
      ['revoked', stored({ revokedAt: new Date() }), undefined],
      ['past its absolute deadline', stored({ familyExpiresAt: past(1) }), 'fam_1'],
      ['idle past its deadline', stored({ idleExpiresAt: past(1) }), 'fam_1'],
    ])('refuses a token that is %s', async (_label, row, revokedFamily) => {
      refreshToken.findUnique.mockResolvedValue(row as never);

      await expect(service.rotate('presented')).rejects.toMatchObject({
        response: { code: API_ERROR_CODES.REFRESH_TOKEN_INVALID },
      });

      if (revokedFamily) {
        expect(refreshToken.updateMany).toHaveBeenCalledWith({
          where: { familyId: revokedFamily, revokedAt: null },
          data: { revokedAt: expect.any(Date) as unknown as Date },
        });
      }
    });

    // ⚠️ The reuse case. A spent token presented again ends the session.
    it('revokes the whole family when a spent token is presented again', async () => {
      refreshToken.findUnique.mockResolvedValue(stored({ usedAt: past(1) }) as never);

      await expect(service.rotate('presented')).rejects.toThrow(UnauthorizedException);

      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as Date },
      });
      // No successor: the transaction is never reached.
      expect(transaction).not.toHaveBeenCalled();
    });

    // Losing the conditional update means another request spent this token
    // between the read and the write — indistinguishable from reuse, and
    // treated the same way.
    it('revokes the family when the conditional spend loses its race', async () => {
      refreshToken.findUnique.mockResolvedValue(stored() as never);
      transaction.mockResolvedValue([{ count: 0 }, {}] as never);

      await expect(service.rotate('presented')).rejects.toMatchObject({
        response: { code: API_ERROR_CODES.REFRESH_TOKEN_INVALID },
      });

      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as Date },
      });
    });

    it.each([
      ['deactivated', { isActive: false, deletedAt: null }],
      ['soft-deleted', { isActive: true, deletedAt: new Date() }],
    ])('refuses and ends the session for a %s account', async (_label, user) => {
      refreshToken.findUnique.mockResolvedValue(stored({ user }) as never);

      await expect(service.rotate('presented')).rejects.toMatchObject({
        response: { code: API_ERROR_CODES.USER_DEACTIVATED },
      });
      await expect(service.rotate('presented')).rejects.toThrow(ForbiddenException);

      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as Date },
      });
    });

    // Every refusal reports one code. Which condition was hit is logged, not
    // returned — see REFRESH_TOKEN_INVALID in packages/shared.
    it('reports the same code whether the token is unknown or reused', async () => {
      refreshToken.findUnique.mockResolvedValue(null as never);
      const unknown = await service.rotate('a').catch((e: unknown) => e);

      refreshToken.findUnique.mockResolvedValue(stored({ usedAt: past(1) }) as never);
      const reused = await service.rotate('b').catch((e: unknown) => e);

      const code = (e: unknown) => (e as UnauthorizedException).getResponse();
      expect(code(unknown)).toEqual(code(reused));
    });
  });

  describe('revokeFamily', () => {
    it('ends every live token in the session', async () => {
      refreshToken.findUnique.mockResolvedValue({ familyId: 'fam_1' } as never);

      await service.revokeFamily('presented');

      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown as Date },
      });
    });

    // Logging out is not a place to tell a caller whether a credential was
    // real, and what they wanted is true either way.
    it('says nothing about an unknown token', async () => {
      refreshToken.findUnique.mockResolvedValue(null as never);

      await expect(service.revokeFamily('presented')).resolves.toBeUndefined();
      expect(refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
