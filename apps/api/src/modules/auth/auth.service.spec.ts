import { prisma } from '@nahuat/database';
import { JwtClaimsSchema } from '@nahuat/shared';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

vi.mock('@nahuat/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
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

describe('AuthService.resolveIdentity', () => {
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

      const result = await service.resolveIdentity(SUB, 'tok');

      expect(result).toEqual({ sub: SUB, userId: 'usr_1', role: 'ADMIN', locale: 'en' });
      expect(() => JwtClaimsSchema.strict().parse(result)).not.toThrow();
    });

    it('looks the user up by auth0Id', async () => {
      user.findUnique.mockResolvedValue(row() as never);
      await service.resolveIdentity(SUB, 'tok');
      expect(user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { auth0Id: SUB } }),
      );
    });

    // The whole point of moving this off the token: it used to run at login, so
    // a deactivated user kept a working token until it expired.
    it('refuses a soft-deleted account', async () => {
      user.findUnique.mockResolvedValue(row({ deletedAt: new Date() }) as never);
      await expect(service.resolveIdentity(SUB, 'tok')).rejects.toBeInstanceOf(ForbiddenException);
      expect(await errorCode(service.resolveIdentity(SUB, 'tok'))).toBe('USER_DEACTIVATED');
    });

    it('refuses an inactive account', async () => {
      user.findUnique.mockResolvedValue(row({ isActive: false }) as never);
      expect(await errorCode(service.resolveIdentity(SUB, 'tok'))).toBe('USER_DEACTIVATED');
    });

    it('does not call /userinfo when the user already exists', async () => {
      const fetchSpy = userinfo({});
      vi.stubGlobal('fetch', fetchSpy);
      user.findUnique.mockResolvedValue(row() as never);

      await service.resolveIdentity(SUB, 'tok');

      expect(fetchSpy).not.toHaveBeenCalled();
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
      user.create.mockResolvedValue({ id: 'usr_new', role: 'USER', locale: 'ES' } as never);

      const result = await service.resolveIdentity(SUB, 'tok');

      expect(user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            auth0Id: SUB,
            email: 'a@b.com',
            name: 'Ada',
            pictureUrl: 'https://img/a.png',
          },
        }),
      );
      expect(result).toMatchObject({ userId: 'usr_new', role: 'USER', locale: 'es' });
    });

    it('sends the access token as the /userinfo credential', async () => {
      const fetchSpy = userinfo({ sub: SUB, email: 'a@b.com' });
      vi.stubGlobal('fetch', fetchSpy);
      user.create.mockResolvedValue({ id: 'u', role: 'USER', locale: 'ES' } as never);

      await service.resolveIdentity(SUB, 'the-token');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://tenant.auth0.com/userinfo',
        expect.objectContaining({ headers: { authorization: 'Bearer the-token' } }),
      );
    });

    // Email OTP supplies no name, and name is non-nullable in the schema.
    it('falls back to the email when the connection supplies no name', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockResolvedValue({ id: 'u', role: 'USER', locale: 'ES' } as never);

      await service.resolveIdentity(SUB, 'tok');

      expect(user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'a@b.com' }) }),
      );
    });

    // A row created under the wrong identity would be nearly impossible to
    // notice afterwards.
    it('refuses when /userinfo describes a different subject', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: 'auth0|someone-else', email: 'a@b.com' }));
      expect(await errorCode(service.resolveIdentity(SUB, 'tok'))).toBe('UNAUTHORIZED');
      expect(user.create).not.toHaveBeenCalled();
    });

    it('refuses when the profile carries no email', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB }));
      expect(await errorCode(service.resolveIdentity(SUB, 'tok'))).toBe('UNAUTHORIZED');
      expect(user.create).not.toHaveBeenCalled();
    });

    it('refuses when /userinfo returns an error status', async () => {
      vi.stubGlobal('fetch', userinfo(null, false, 401));
      await expect(service.resolveIdentity(SUB, 'tok')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuses when /userinfo is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
      expect(await errorCode(service.resolveIdentity(SUB, 'tok'))).toBe('UNAUTHORIZED');
    });

    // A page load fires several requests at once, so two can both miss and both
    // insert. The loser re-reads what the winner wrote. The first findUnique is
    // the initial miss; the second is the recovery read.
    it('recovers from a concurrent insert by re-reading', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(uniqueViolation(['auth0_id']) as never);
      user.findUnique.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
        id: 'usr_winner',
        role: 'CONTRIBUTOR',
        locale: 'EN',
      } as never);

      const result = await service.resolveIdentity(SUB, 'tok');

      expect(result).toEqual({
        sub: SUB,
        userId: 'usr_winner',
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

      expect(await errorCode(service.resolveIdentity(SUB, 'tok'))).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('does not name the connection that owns the address', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'taken@b.com' }));
      user.create.mockRejectedValue(uniqueViolation(['email']) as never);

      // Confirming which connection holds an address would confirm the address
      // is registered at all — an enumeration oracle on a public login page.
      try {
        await service.resolveIdentity(SUB, 'tok');
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
        .mockResolvedValueOnce({ id: 'usr_winner', role: 'USER', locale: 'ES' } as never);

      const result = await service.resolveIdentity(SUB, 'tok');
      expect(result).toMatchObject({ userId: 'usr_winner' });
    });

    // Whatever this is, it is not something to guess at — and it must not leak.
    it('refuses cleanly when a unique violation leaves no readable row', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(uniqueViolation(['username']) as never);
      user.findUnique.mockResolvedValue(null as never);

      expect(await errorCode(service.resolveIdentity(SUB, 'tok'))).toBe('UNAUTHORIZED');
    });

    it('rethrows a create failure that is not a unique violation', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(new Error('connection lost') as never);
      await expect(service.resolveIdentity(SUB, 'tok')).rejects.toThrow('connection lost');
    });
  });
});
