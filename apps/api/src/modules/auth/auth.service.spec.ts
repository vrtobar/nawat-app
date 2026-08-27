import { prisma } from '@nahuat/database';
import { JwtClaimsSchema } from '@nahuat/shared';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

vi.mock('@nahuat/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  },
}));

const user = vi.mocked(prisma.user);

const SUB = 'google-oauth2|1038929';

// A P2002 shaped the way the pg driver adapter reports it. Prisma's documented
// meta.target is undefined under that adapter; the columns live on the
// adapter's error cause, which is what uniqueViolationFields reads.
const uniqueViolation = (fields: string[]) =>
  Object.assign(new Error('unique constraint'), {
    code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { fields } } } },
  });

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'usr_1',
  role: 'USER',
  locale: 'ES',
  deletedAt: null,
  isActive: true,
  ...overrides,
});

// What USER_PROFILE_SELECT returns. startSession resolves to a UserProfile,
// where resolveIdentity resolves to JwtClaims — different shapes, so the two
// need different fixtures.
const profileRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'usr_1',
  email: 'a@b.com',
  name: 'Ada',
  role: 'USER',
  locale: 'ES',
  username: null,
  pictureUrl: null,
  xp: 0,
  streak: 0,
  lastActiveAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

// A verified Google identity, as GoogleIdentityService returns it. The profile
// arrives with the credential now, so there is no /userinfo stub here and no
// network at all on this path — the tests that covered its four failure modes
// were deleted with it, and the token's own verification is covered in
// google-identity.service.spec.ts.
const identity = (overrides: Record<string, unknown> = {}) => ({
  sub: SUB,
  email: 'a@b.com',
  name: 'Ada',
  picture: 'https://img/a.png',
  ...overrides,
});

const errorCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    throw new Error('expected a rejection, but it resolved');
  } catch (error) {
    const payload = (error as { getResponse?: () => unknown }).getResponse?.();
    return (payload as { code?: string })?.code ?? 'NOT_AN_HTTP_EXCEPTION';
  }
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('an existing, active user', () => {
    it('returns the identity from the database, not from the token', async () => {
      user.findUnique.mockResolvedValue(row({ role: 'ADMIN', locale: 'EN' }) as never);

      const result = await service.resolveIdentity(SUB);

      expect(result).toEqual({ sub: SUB, userId: 'usr_1', role: 'ADMIN', locale: 'en' });
      expect(() => JwtClaimsSchema.strict().parse(result)).not.toThrow();
    });

    it('looks the user up by auth0Id', async () => {
      user.findUnique.mockResolvedValue(row() as never);
      await service.resolveIdentity(SUB);
      expect(user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { auth0Id: SUB } }),
      );
    });

    // The whole point of moving this off the token: it used to run at login, so
    // a deactivated user kept a working token until it expired.
    it('refuses a soft-deleted account', async () => {
      user.findUnique.mockResolvedValue(row({ deletedAt: new Date() }) as never);
      await expect(service.resolveIdentity(SUB)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await errorCode(service.resolveIdentity(SUB))).toBe('USER_DEACTIVATED');
    });

    it('refuses an inactive account', async () => {
      user.findUnique.mockResolvedValue(row({ isActive: false }) as never);
      expect(await errorCode(service.resolveIdentity(SUB))).toBe('USER_DEACTIVATED');
    });

    // A regression guard, not a description: putting a network call back on
    // the per-request path is the mistake this whole design exists to avoid,
    // and it would be invisible until something slow made it a latency
    // problem.
    it('makes no network call at all', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      user.findUnique.mockResolvedValue(row() as never);

      await service.resolveIdentity(SUB);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  // The behaviour that replaced lazy provisioning. A verified subject with no
  // row used to be created here; it is now a fault, which is what stops a
  // hard-deleted user reappearing on their next request.
  describe('a subject with no account', () => {
    it('refuses with ACCOUNT_NOT_PROVISIONED rather than creating one', async () => {
      user.findUnique.mockResolvedValue(null as never);

      await expect(service.resolveIdentity(SUB)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(await errorCode(service.resolveIdentity(SUB))).toBe('ACCOUNT_NOT_PROVISIONED');
      expect(user.create).not.toHaveBeenCalled();
    });
  });

  // The half of startSession that is not creation. Nothing re-synced a profile
  // between the Post Login Action's deletion and this, so a name or avatar
  // changed upstream never propagated.
  describe('a returning user', () => {
    it('re-syncs the profile and stamps lastLoginAt', async () => {
      user.findUnique.mockResolvedValue({ id: 'usr_1', deletedAt: null, isActive: true } as never);
      user.update.mockResolvedValue(profileRow({ name: 'Ada Renamed' }) as never);

      const result = await service.startSession(identity({ name: 'Ada Renamed' }));

      expect(user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { auth0Id: SUB },
          data: expect.objectContaining({
            name: 'Ada Renamed',
            lastLoginAt: expect.any(Date),
          }),
        }),
      );
      expect(result.name).toBe('Ada Renamed');
      expect(user.create).not.toHaveBeenCalled();
    });

    // email is the unique key. Following a change upstream could collide with
    // another row, and the collision would surface as a failed login for
    // someone who changed nothing.
    it('never re-syncs the email', async () => {
      user.findUnique.mockResolvedValue({ id: 'usr_1', deletedAt: null, isActive: true } as never);
      user.update.mockResolvedValue(profileRow() as never);

      await service.startSession(identity());

      const data = user.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data).not.toHaveProperty('email');
    });

    // Better to say so at sign-in than to let them in and fail every request.
    it('refuses a deactivated account instead of recording a login', async () => {
      user.findUnique.mockResolvedValue({ id: 'usr_1', deletedAt: null, isActive: false } as never);

      expect(await errorCode(service.startSession(identity()))).toBe('USER_DEACTIVATED');
      expect(user.update).not.toHaveBeenCalled();
    });

    it('refuses a soft-deleted account', async () => {
      user.findUnique.mockResolvedValue({
        id: 'usr_1',
        deletedAt: new Date(),
        isActive: true,
      } as never);

      expect(await errorCode(service.startSession(identity()))).toBe('USER_DEACTIVATED');
      expect(user.update).not.toHaveBeenCalled();
    });
  });

  describe('provisioning a first-time user', () => {
    beforeEach(() => {
      user.findUnique.mockResolvedValue(null as never);
    });

    it("creates the row from the ID token's own claims", async () => {
      user.create.mockResolvedValue(profileRow({ id: 'usr_new' }) as never);

      const result = await service.startSession(identity());

      expect(user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            auth0Id: SUB,
            email: 'a@b.com',
            name: 'Ada',
            pictureUrl: 'https://img/a.png',
            lastLoginAt: expect.any(Date),
          }),
        }),
      );
      expect(result).toMatchObject({ id: 'usr_new', role: 'USER', locale: 'es' });
    });

    // Google does not always supply a name, and name is non-nullable.
    it('falls back to the email when Google supplies no name', async () => {
      user.create.mockResolvedValue(profileRow({ id: 'u' }) as never);

      await service.startSession(identity({ name: undefined }));

      expect(user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'a@b.com' }) }),
      );
    });

    // A page load fires several requests at once, so two can both miss and both
    // insert. The loser re-reads what the winner wrote. The first findUnique is
    // the initial miss; the second is the recovery read.
    it('recovers from a concurrent insert by re-reading', async () => {
      user.create.mockRejectedValue(uniqueViolation(['auth0_id']) as never);
      user.findUnique
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(
          profileRow({ id: 'usr_winner', role: 'CONTRIBUTOR', locale: 'EN' }) as never,
        );

      const result = await service.startSession(identity());

      expect(result).toMatchObject({
        id: 'usr_winner',
        role: 'CONTRIBUTOR',
        locale: 'en',
      });
    });

    // Auth0 keys identity on connection + subject, so signing in with Google
    // and with an email code produce different `sub` values for one person. The
    // second arrives here as a new user whose email is already taken.
    //
    // The original code assumed every P2002 was a race on auth0_id, re-read by
    // auth0Id, found nothing, and let Prisma's NotFoundError — carrying the
    // query and absolute source paths — reach the client as a 401 body.
    it('refuses a second identity whose email is already registered', async () => {
      user.create.mockRejectedValue(uniqueViolation(['email']) as never);

      expect(await errorCode(service.startSession(identity()))).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('does not name the connection that owns the address', async () => {
      user.create.mockRejectedValue(uniqueViolation(['email']) as never);

      // Confirming which connection holds an address would confirm the address
      // is registered at all — an enumeration oracle on a public login page.
      try {
        await service.startSession(identity());
        expect.unreachable('should have thrown');
      } catch (error) {
        const payload = (error as { getResponse: () => { message: string } }).getResponse();
        expect(payload.message).not.toContain('taken@b.com');
        expect(payload.message.toLowerCase()).not.toContain('google');
      }
    });

    // uniqueViolationFields reaches into an adapter-specific error shape and
    // returns [] if Prisma ever moves it. A genuine race must still recover.
    it('still recovers from a race when the violated fields cannot be read', async () => {
      user.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }) as never);
      user.findUnique
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(profileRow({ id: 'usr_winner' }) as never);

      const result = await service.startSession(identity());
      expect(result).toMatchObject({ id: 'usr_winner' });
    });

    // Whatever this is, it is not something to guess at — and it must not leak.
    it('refuses cleanly when a unique violation leaves no readable row', async () => {
      user.create.mockRejectedValue(uniqueViolation(['username']) as never);
      user.findUnique.mockResolvedValue(null as never);

      expect(await errorCode(service.startSession(identity()))).toBe('UNAUTHORIZED');
    });

    it('rethrows a create failure that is not a unique violation', async () => {
      user.create.mockRejectedValue(new Error('connection lost') as never);
      await expect(service.startSession(identity())).rejects.toThrow('connection lost');
    });
  });
});
