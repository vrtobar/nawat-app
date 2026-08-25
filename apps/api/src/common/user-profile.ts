import type { UserProfile } from '@nahuat/shared';

import { LOCALE_TO_WIRE } from './locale';

// The columns GET /users/me and POST /auth/session both return, in one place
// so the two cannot drift.
//
// Listed explicitly rather than returning the row: auth0Id and deletedAt are
// not the client's business, and a select-all would start leaking whatever the
// next migration adds. lastLoginAt is deliberately absent — it exists to
// answer "is this account dormant", which is an operator question rather than
// something the profile page renders.
export const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  locale: true,
  username: true,
  pictureUrl: true,
  xp: true,
  streak: true,
  lastActiveAt: true,
  createdAt: true,
} as const;

type UserProfileRow = {
  id: string;
  email: string;
  name: string;
  role: UserProfile['role'];
  locale: keyof typeof LOCALE_TO_WIRE;
  username: string | null;
  pictureUrl: string | null;
  xp: number;
  streak: number;
  lastActiveAt: Date | null;
  createdAt: Date;
};

// Prisma returns Date objects and the database's Locale enum; the wire contract
// is ISO strings and a lowercase locale (ADR 15). One mapper so the conversion
// is not repeated per call site.
export function toUserProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    locale: LOCALE_TO_WIRE[row.locale],
    username: row.username,
    pictureUrl: row.pictureUrl,
    xp: row.xp,
    streak: row.streak,
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
