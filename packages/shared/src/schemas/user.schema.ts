import { z } from 'zod';

import { LocaleSchema } from './locale.schema';

// -----------------------------------------------------------------------------
// ENUMS
// -----------------------------------------------------------------------------

export const RoleSchema = z.enum(['USER', 'CONTRIBUTOR', 'ADMIN']);

export type Role = z.infer<typeof RoleSchema>;

// -----------------------------------------------------------------------------
// USER PROFILE
// Returned from /users/me.
// Sensitive fields excluded: auth0Id, deletedAt, updatedAt.
// username is nullable and stays null: nothing generates it, because nothing
// displays it. See BACKLOG — user-published flashcard sets or a leaderboard
// are what would give it a consumer.
// -----------------------------------------------------------------------------

export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  role: RoleSchema,
  // Which language this user reads content in. Defaults to 'es' on signup and
  // there is deliberately no DTO to change it yet: nothing serves localized
  // content, so a write path would join PublicUserProfileSchema in the set of
  // shapes nothing renders. Add it with the endpoint that needs it.
  locale: LocaleSchema,
  username: z.string().nullable(),
  pictureUrl: z.url().nullable(),
  xp: z.number().int(),
  streak: z.number().int(),
  lastActiveAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// -----------------------------------------------------------------------------
// RESOLVED IDENTITY
// What JwtStrategy.validate() attaches to the request as `user`, and what
// RolesGuard, @CurrentUser and @ContentLocale read.
//
// NOT A TOKEN PAYLOAD, despite the name. Only `sub` comes from the access
// token; role, userId and locale are read from the database on each request.
// Auth0 stamped them as namespaced custom claims until 2026-08-24 — see
// docs/adr/0013 for why that was reversed. The shape is unchanged from that
// era on purpose: every consumer reads the same fields, so the source could
// move without touching any of them.
//
// email and name stay absent. An access token carries only `sub` and the
// standard registered claims — requiring a profile here rejected every genuine
// token once already, verified against a real one on 2026-08-16 — and anything
// wanting the profile reads it from the database, which is now the only source
// for all of this.
//
// `locale` is required, where it was optional while it rode on the token: a
// user row always has one, so there is no longer a case where it is absent for
// an authenticated request. @ContentLocale still falls back to Accept-Language
// for anonymous ones, which have no user at all.
// -----------------------------------------------------------------------------

export const JwtClaimsSchema = z.object({
  sub: z.string(), // Auth0 user id, e.g. google-oauth2|1038929...
  role: RoleSchema, // User.role
  userId: z.string(), // User.id — the Nawat platform id
  locale: LocaleSchema, // User.locale
});

export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

// -----------------------------------------------------------------------------
// USERNAME
// PATCH /users/me/username — editable once per 30 days.
// Lowercase letters, numbers, underscores. Min 3, max 30 chars.
// -----------------------------------------------------------------------------

export const UpdateUsernameSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers, and underscores only'),
});

export type UpdateUsername = z.infer<typeof UpdateUsernameSchema>;

// -----------------------------------------------------------------------------
// ADMIN — USER LIST ITEM
// Used in admin user management table.
// Includes isActive and deletedAt for moderation.
// -----------------------------------------------------------------------------

export const AdminUserListItemSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  role: RoleSchema,
  xp: z.number().int(),
  streak: z.number().int(),
  isActive: z.boolean(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type AdminUserListItem = z.infer<typeof AdminUserListItemSchema>;

// -----------------------------------------------------------------------------
// ADMIN — UPDATE USER ROLE
// Admin-only endpoint to change a user's role.
// -----------------------------------------------------------------------------

export const UpdateUserRoleSchema = z.object({
  role: RoleSchema,
});

export type UpdateUserRole = z.infer<typeof UpdateUserRoleSchema>;

// -----------------------------------------------------------------------------
// PUBLIC PROFILE
// Future: /u/[username] public profile page.
// Excludes email and internal fields.
// -----------------------------------------------------------------------------

export const PublicUserProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  xp: z.number().int(),
  streak: z.number().int(),
});

export type PublicUserProfile = z.infer<typeof PublicUserProfileSchema>;
