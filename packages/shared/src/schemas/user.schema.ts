import { z } from 'zod';

// -----------------------------------------------------------------------------
// ENUMS
// -----------------------------------------------------------------------------

export const RoleSchema = z.enum(['USER', 'REVIEWER', 'CONTRIBUTOR', 'ADMIN']);

export type Role = z.infer<typeof RoleSchema>;

// -----------------------------------------------------------------------------
// USER PROFILE
// Returned from /auth/me and /users/me.
// Sensitive fields excluded: auth0Id, deletedAt, updatedAt.
// username is nullable — auto-generated on first login, but the field
// itself is optional in the DB until that upsert runs.
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

export const JwtClaimsSchema = z.object({
  sub: z.string(), // Auth0 user id
  email: z.email(),
  name: z.string(),
  role: RoleSchema,
  userId: z.string(), // Nahuat platform user id
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
