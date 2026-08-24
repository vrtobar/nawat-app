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
    // insert. The loser re-reads what the winner wrote.
    it('recovers from a concurrent insert by re-reading', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }) as never);
      user.findUniqueOrThrow.mockResolvedValue({
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

    it('rethrows a create failure that is not a unique violation', async () => {
      vi.stubGlobal('fetch', userinfo({ sub: SUB, email: 'a@b.com' }));
      user.create.mockRejectedValue(new Error('connection lost') as never);
      await expect(service.resolveIdentity(SUB, 'tok')).rejects.toThrow('connection lost');
    });
  });
});
