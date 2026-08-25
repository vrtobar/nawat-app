import { SetMetadata } from '@nestjs/common';

export const ALLOW_MISSING_ACCOUNT = 'allowMissingAccount';

// Authenticate the token, but do not require an account behind it.
//
// EXACTLY ONE ROUTE NEEDS THIS, and the reason is a genuine chicken and egg:
// POST /auth/session is what creates an account, and the guard's account
// lookup would reject the caller before it ran. Every other authenticated
// route should require the account, which is why this is opt-in.
//
// A route carrying it receives `{ sub }` on request.user rather than full
// JwtClaims — there is no role to check and no user id to attribute to, so
// @Roles() and @CurrentUser() have nothing to read. That is the point: it is
// the pre-account state, and the type reflects it.
export const AllowMissingAccount = () => SetMetadata(ALLOW_MISSING_ACCOUNT, true);
