import { prisma } from '@nahuat/database';
import { JwtClaimsSchema } from '@nahuat/shared';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

vi.mock('@nahuat/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  },
}));

const user = vi.mocked(prisma.user);

// Only AUTH0_DOMAIN is read, and only to build the /userinfo URL.
const config = { get: () => 'tenant.auth0.com' } as unknown as ConfigService<never, true>;

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

// A fetch stub standing in for Auth0's /userinfo.
const userinfo = (body: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
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
    service = new AuthService(config);
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

    // resolveIdentity never reaches Auth0 now — it cannot create anything, so
    // it has no reason to. Kept as a regression guard: putting a network call
    // back on the per-request path is the mistake this design exists to avoid.
    it('never calls /userinfo', async () => {
      const fetchSpy = userinfo({});
      vi.stubGlobal('fetch', fetchSpy);
      user.findUnique.mockResolvedValue(row() as never);

      await service.resolveIdentity(SUB);

      expect(fetchSpy).not.toHaveBeenCalled();
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
    beforeEach(() => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com', name: 'Ada Renamed' }));
    });

    it('re-syncs the profile and stamps lastLoginAt', async () => {
      user.findUnique.mockResolvedValue({ id: 'usr_1', deletedAt: null, isActive: true } as never);
      user.update.mockResolvedValue(profileRow({ name: 'Ada Renamed' }) as never);

      const result = await service.startSession(SUB, 'tok');

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

      await service.startSession(SUB, 'tok');

      const data = user.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data).not.toHaveProperty('email');
    });

    // Better to say so at sign-in than to let them in and fail every request.
    it('refuses a deactivated account instead of recording a login', async () => {
      user.findUnique.mockResolvedValue({ id: 'usr_1', deletedAt: null, isActive: false } as never);

      expect(await errorCode(service.startSession(SUB, 'tok'))).toBe('USER_DEACTIVATED');
      expect(user.update).not.toHaveBeenCalled();
    });

    it('refuses a soft-deleted account', async () => {
      user.findUnique.mockResolvedValue({
        id: 'usr_1',
        deletedAt: new Date(),
        isActive: true,
      } as never);

      expect(await errorCode(service.startSession(SUB, 'tok'))).toBe('USER_DEACTIVATED');
      expect(user.update).not.toHaveBeenCalled();
    });
  });

  describe('provisioning a first-time user', () => {
    beforeEach(() => {
      user.findUnique.mockResolvedValue(null as never);
    });

    it('creates the row from the Auth0 profile', async () => {
      vi.stubGlobal(
        'fetch',
        userinfo({ sub: SUB, email: 'a@b.com', name: 'Ada', picture: 'https://img/a.png' }),
      );
      user.create.mockResolvedValue(profileRow({ id: 'usr_new' }) as never);

      const result = await service.startSession(SUB, 'tok');

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

    it('sends the access token as the /userinfo credential', async () => {
      const fetchSpy = userinfo({ sub: SUB, email: 'a@b.com' });
      vi.stubGlobal('fetch', fetchSpy);
      user.create.mockResolvedValue(profileRow({ id: 'u' }) as never);

      await service.startSession(SUB, 'the-token');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://tenant.auth0.com/userinfo',
        expect.objectContaining({ headers: { authorization: 'Bearer the-token' } }),
      );
    });

    // Email OTP supplies no name, and name is non-nullable in the schema.
    it('falls back to the email when the connection supplies no name', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockResolvedValue(profileRow({ id: 'u' }) as never);

      await service.startSession(SUB, 'tok');

      expect(user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'a@b.com' }) }),
      );
    });

    // A row created under the wrong identity would be nearly impossible to
    // notice afterwards.
    it('refuses when /userinfo describes a different subject', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: 'auth0|someone-else', email: 'a@b.com' }));
      expect(await errorCode(service.startSession(SUB, 'tok'))).toBe('UNAUTHORIZED');
      expect(user.create).not.toHaveBeenCalled();
    });

    it('refuses when the profile carries no email', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB }));
      expect(await errorCode(service.startSession(SUB, 'tok'))).toBe('UNAUTHORIZED');
      expect(user.create).not.toHaveBeenCalled();
    });

    it('refuses when /userinfo returns an error status', async () => {
      vi.stubGlobal('fetch', userinfo(null, false, 401));
      await expect(service.startSession(SUB, 'tok')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses when /userinfo is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
      expect(await errorCode(service.startSession(SUB, 'tok'))).toBe('UNAUTHORIZED');
    });

    // A page load fires several requests at once, so two can both miss and both
    // insert. The loser re-reads what the winner wrote. The first findUnique is
    // the initial miss; the second is the recovery read.
    it('recovers from a concurrent insert by re-reading', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(uniqueViolation(['auth0_id']) as never);
      user.findUnique
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(
          profileRow({ id: 'usr_winner', role: 'CONTRIBUTOR', locale: 'EN' }) as never,
        );

      const result = await service.startSession(SUB, 'tok');

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
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'taken@b.com' }));
      user.create.mockRejectedValue(uniqueViolation(['email']) as never);

      expect(await errorCode(service.startSession(SUB, 'tok'))).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('does not name the connection that owns the address', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'taken@b.com' }));
      user.create.mockRejectedValue(uniqueViolation(['email']) as never);

      // Confirming which connection holds an address would confirm the address
      // is registered at all — an enumeration oracle on a public login page.
      try {
        await service.startSession(SUB, 'tok');
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
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }) as never);
      user.findUnique
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(profileRow({ id: 'usr_winner' }) as never);

      const result = await service.startSession(SUB, 'tok');
      expect(result).toMatchObject({ id: 'usr_winner' });
    });

    // Whatever this is, it is not something to guess at — and it must not leak.
    it('refuses cleanly when a unique violation leaves no readable row', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(uniqueViolation(['username']) as never);
      user.findUnique.mockResolvedValue(null as never);

      expect(await errorCode(service.startSession(SUB, 'tok'))).toBe('UNAUTHORIZED');
    });

    it('rethrows a create failure that is not a unique violation', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(new Error('connection lost') as never);
      await expect(service.startSession(SUB, 'tok')).rejects.toThrow('connection lost');
    });
  });
});
