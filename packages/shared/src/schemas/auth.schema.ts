import { z } from 'zod';

import { UserProfileSchema } from './user.schema';

// =============================================================================
// AUTHENTICATION — the contracts between the web tier and this project's own
// authorization server. See docs/adr/0018.
//
// WHO HOLDS WHAT, because it is the thing that makes these shapes safe:
//
//   browser        an encrypted session cookie written by Auth.js, and nothing
//                    else — it never sees either token below
//   web server     both tokens, inside that cookie, and GOOGLE_CLIENT_SECRET
//   api            the RS256 signing key, and the refresh token store
//
// Every call carrying these shapes is server-to-server. That is why a refresh
// token travels in a response BODY here, which would be a defect in a
// browser-facing API: there is no browser on either end of the exchange, and
// the alternative — the API setting a cookie — would only work for a caller
// that is a browser, which is precisely the coupling docs/adr/0018 rejected in
// order to keep the API callable by Postman, a script, or a future mobile
// client.
// =============================================================================

// -----------------------------------------------------------------------------
// TOKEN PAIR
//
// `expiresIn` is SECONDS REMAINING, not an absolute time, and it is deliberate:
// the caller computes its own deadline from its own clock. An absolute `exp`
// would make the web tier's refresh decision depend on its clock agreeing with
// the API's, and a few seconds of drift would either refresh a token early
// forever or let an expired one through — a fault that appears only on a
// machine whose clock has slipped, which is the hardest kind to reproduce.
//
// It also means the web tier never decodes the access token. It is an opaque
// bearer string on that side; only the API parses it, which keeps the number of
// places that know the token's internal shape at one.
// -----------------------------------------------------------------------------

export const TokenPairSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});

export type TokenPair = z.infer<typeof TokenPairSchema>;

// -----------------------------------------------------------------------------
// POST /auth/session — a login just happened
//
// The credential is Google's ID TOKEN, not an authorization code and not an
// access token. Auth.js has already completed the code exchange in the web
// tier, so the code is spent by the time this is called; what survives is the
// signed assertion about who logged in.
//
// The API verifies it against Google's JWKS and reads the profile straight out
// of its claims. That deletes the /userinfo round trip this endpoint used to
// make against Auth0 — one fewer network call on the login path, and one fewer
// way for a login to hang.
//
// STILL THE ONLY PATH THAT CREATES AN ACCOUNT, and still idempotent: calling it
// again re-syncs the profile and moves lastLoginAt.
// -----------------------------------------------------------------------------

export const StartSessionSchema = z.object({
  idToken: z.string().min(1),
});

export type StartSession = z.infer<typeof StartSessionSchema>;

// Returns the profile as well as the tokens so the caller needs no second
// request to learn who it just signed in, and no second schema to parse it
// with — the property the Auth0-era endpoint had, kept.
export const SessionResponseSchema = z.object({
  user: UserProfileSchema,
  tokens: TokenPairSchema,
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

// -----------------------------------------------------------------------------
// POST /auth/refresh — exchange a refresh token for a new pair
//
// The response is a new PAIR, never a lone access token: refresh tokens rotate,
// so the presented one is invalid the moment this returns. A caller that kept
// using it would be indistinguishable from an attacker replaying a stolen one,
// and would have its whole family revoked on the next call.
//
// No user profile here. Refresh runs far more often than login, identity is
// resolved from the database on every authenticated request anyway, and
// returning a profile would invite callers to treat this as a cheap /users/me.
// -----------------------------------------------------------------------------

export const RefreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshSession = z.infer<typeof RefreshSessionSchema>;

export const RefreshResponseSchema = z.object({
  tokens: TokenPairSchema,
});

export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

// -----------------------------------------------------------------------------
// POST /auth/logout — end THIS session
//
// Takes the refresh token rather than reading the caller's access token,
// because the access token names a user and this has to name a session. Ending
// every session a user has is a different act with a different endpoint, and
// conflating them is how a Log out link signs someone out of their phone.
//
// Revokes the presented token's entire family, not just the token: the family
// is the session, and the tokens in it are the same session at different
// moments.
// -----------------------------------------------------------------------------

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export type Logout = z.infer<typeof LogoutSchema>;
