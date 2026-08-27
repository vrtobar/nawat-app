import { prisma } from '@nahuat/database';
import { UserProfileSchema } from '@nahuat/shared';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersService } from './users.service';

vi.mock('@nahuat/database', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

const findUnique = vi.mocked(prisma.user.findUnique);

// The Prisma mock is cast to `never`: findUnique's return type is an elaborate
// overload no hand-written fixture satisfies, and typing it is not worth the
// noise. The cost is that TypeScript then checks nothing about what the service
// returns — a required field mapped to undefined, or a Date left unserialised,
// slips straight through toMatchObject, which ignores absent keys. getProfile
// closes that by parsing the response through the shared schema.
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

// Mocks the row, runs findProfile, and asserts the result IS the contract it
// declares. Strict, so a leaked internal field fails exactly as a missing
// required one does, and the schema's ISO-string dates reject a Date that
// escaped serialisation. UserProfileSchema is the single source of truth for
// that shape, so this assertion cannot drift from it — which is the check the
// `as never` mock otherwise removes. Returns the raw service output so each
// test can pin specific values.
const getProfile = async (overrides: Record<string, unknown> = {}) => {
  findUnique.mockResolvedValue(row(overrides) as never);
  const profile = await new UsersService().findProfile('usr_1');
  UserProfileSchema.strict().parse(profile);
  return profile;
};

describe('UsersService', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the profile for a live user', async () => {
    await expect(getProfile()).resolves.toMatchObject({ id: 'usr_1', role: 'USER', xp: 40 });
  });

  it('maps the locale enum to its wire format', async () => {
    // The column is ES/EN and the contract is es/en. getProfile's schema parse
    // is what makes this real: without it the mapping could return undefined and
    // every other test in this file would still pass.
    await expect(getProfile({ locale: 'EN' })).resolves.toMatchObject({ locale: 'en' });
  });

  it('serialises dates as ISO strings', async () => {
    // UserProfileSchema declares ISO strings; Prisma hands back Date objects.
    // getProfile's parse already rejects an unserialised Date; these pin the
    // exact values.
    const profile = await getProfile();

    expect(profile.createdAt).toBe('2026-08-01T09:00:00.000Z');
    expect(profile.lastActiveAt).toBe('2026-08-15T10:00:00.000Z');
  });

  it('keeps a null lastActiveAt null', async () => {
    await expect(getProfile({ lastActiveAt: null })).resolves.toMatchObject({ lastActiveAt: null });
  });

  it('never returns deletedAt, isActive, or googleId', async () => {
    // Selected in order to decide, not to disclose. getProfile's strict parse
    // would already reject any of these; the explicit checks name the fields
    // that must never reach a client.
    const profile = await getProfile();

    expect(profile).not.toHaveProperty('deletedAt');
    expect(profile).not.toHaveProperty('isActive');
    expect(profile).not.toHaveProperty('googleId');
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
