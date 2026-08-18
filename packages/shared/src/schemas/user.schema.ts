import { z } from 'zod';

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
  username: z.string().nullable(),
  pictureUrl: z.url().nullable(),
  xp: z.number().int(),
  streak: z.number().int(),
  lastActiveAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// -----------------------------------------------------------------------------
// JWT CLAIMS
// Shape of the fat JWT payload — embedded by Auth0 Post Login Action.
// NestJS JwtStrategy.validate() maps this to the request user object.
// role and userId come from the namespaced custom claims
// (https://nahuat.com/role, https://nahuat.com/userId).
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// LOGIN SYNC — POST /auth/role
// Called by the Auth0 Post Login Action, authenticated by x-internal-secret
// rather than a JWT: it runs before any token exists. It is the single write
// path for User identity fields, and the only moment "synced from Auth0 on
// every login" actually means anything.
//
// POST rather than GET because it upserts. A GET that writes may be retried or
// cached by intermediaries, and the alternative — profile fields as query
// params — puts the user's email and name into every access log.
// -----------------------------------------------------------------------------

export const SyncUserSchema = z.object({
  auth0Id: z.string().min(1), // Auth0 `sub`, e.g. "google-oauth2|123"
  email: z.email(),
  // Auth0 omits `name` for some connections; the Action sends the email in its
  // place rather than leaving it blank, since User.name is non-nullable.
  name: z.string().min(1),
  pictureUrl: z.url().nullish(),
});

export type SyncUser = z.infer<typeof SyncUserSchema>;

// What the Action embeds into the access token as namespaced claims.
export const AuthRoleSchema = z.object({
  userId: z.string(),
  role: RoleSchema,
});

export type AuthRole = z.infer<typeof AuthRoleSchema>;

// Everything the API can rely on being present in an Auth0 ACCESS token.
//
// email and name are deliberately absent. Auth0 puts them in the ID token,
// which the browser holds and the API never sees — an access token carries
// only `sub`, standard registered claims, and whatever the Post Login Action
// adds. Requiring them here rejected every genuine token, verified against a
// real one on 2026-08-16.
//
// They are also not needed. Authorization uses userId and role; anything
// wanting the profile reads it from the database, where /auth/role syncs it on
// every login. Adding them as custom claims would have made the schema true at
// the cost of putting PII in every request and duplicating a source of truth.
export const JwtClaimsSchema = z.object({
  sub: z.string(), // Auth0 user id, e.g. google-oauth2|1038929...
  role: RoleSchema, // https://nahuat.com/role
  userId: z.string(), // https://nahuat.com/userId — the Nahuat platform id
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
