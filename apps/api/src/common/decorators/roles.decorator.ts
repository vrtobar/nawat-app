import type { Role } from '@nahuat/shared';
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Minimum role required for a handler. Ranked, not exact — see RolesGuard.
//
//   @Roles('CONTRIBUTOR')   // CONTRIBUTOR and ADMIN
//   @Roles('ADMIN')         // ADMIN only
//
// Ordering is safe because each role is a strict superset of the one below it:
// CONTRIBUTOR adds reading and editing drafts, ADMIN adds publishing and user
// management.
export const Roles = (minimum: Role) => SetMetadata(ROLES_KEY, minimum);
