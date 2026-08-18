import { prisma } from '@nahuat/database';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersService } from './users.service';

vi.mock('@nahuat/database', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

const findUnique = vi.mocked(prisma.user.findUnique);

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'usr_1',
  email: 'victor@example.com',
  name: 'Victor',
  role: 'USER',
  locale: 'ES',
  username: null,
  pictureUrl: null,
  xp: 40,
  streak: 3,
  lastActiveAt: new Date('2026-08-15T10:00:00.000Z'),
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  deletedAt: null,
  isActive: true,
  ...overrides,
});

describe('UsersService', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the profile for a live user', async () => {
    findUnique.mockResolvedValue(row() as never);

    await expect(new UsersService().findProfile('usr_1')).resolves.toMatchObject({
      id: 'usr_1',
      role: 'USER',
      xp: 40,
    });
  });

  it('maps the locale enum to its wire format', async () => {
    // The column is ES/EN and the contract is es/en. The mock is cast to
    // `never`, so nothing about this crosses the type checker — without an
    // assertion the service can return undefined here and every other test in
    // this file still passes.
    findUnique.mockResolvedValue(row({ locale: 'EN' }) as never);

    await expect(new UsersService().findProfile('usr_1')).resolves.toMatchObject({
      locale: 'en',
    });
  });

  it('serialises dates as ISO strings', async () => {
    // UserProfileSchema declares ISO strings; Prisma hands back Date objects,
    // and the frontend parses with the same schema it types against.
    findUnique.mockResolvedValue(row() as never);

    const profile = await new UsersService().findProfile('usr_1');

    expect(profile.createdAt).toBe('2026-08-01T09:00:00.000Z');
    expect(profile.lastActiveAt).toBe('2026-08-15T10:00:00.000Z');
  });

  it('keeps a null lastActiveAt null', async () => {
    findUnique.mockResolvedValue(row({ lastActiveAt: null }) as never);

    await expect(new UsersService().findProfile('usr_1')).resolves.toMatchObject({
      lastActiveAt: null,
    });
  });

  it('never returns deletedAt or isActive', async () => {
    // They are selected in order to decide, not to disclose.
    findUnique.mockResolvedValue(row() as never);

    const profile = await new UsersService().findProfile('usr_1');

    expect(profile).not.toHaveProperty('deletedAt');
    expect(profile).not.toHaveProperty('isActive');
    expect(profile).not.toHaveProperty('auth0Id');
  });

  it('rejects a token whose user row is gone', async () => {
    // Hard-deleted after the token was issued. The token is still signed and
    // unexpired; what it asserts is no longer true.
    findUnique.mockResolvedValue(null as never);

    await expect(new UsersService().findProfile('usr_gone')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a soft-deleted user mid-session', async () => {
    // Revoking the Auth0 session stops the next login but does nothing to a
    // token already issued. Without this they keep working until it expires.
    findUnique.mockResolvedValue(row({ deletedAt: new Date() }) as never);

    await expect(new UsersService().findProfile('usr_1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a deactivated user', async () => {
    findUnique.mockResolvedValue(row({ isActive: false }) as never);

    await expect(new UsersService().findProfile('usr_1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
