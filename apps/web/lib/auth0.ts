import { Auth0Client } from '@auth0/nextjs-auth0/server';

// Reads AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET,
// and APP_BASE_URL from the environment automatically (v4 SDK).
//
// The SDK auto-mounts its routes under /auth/* via proxy.ts:
//   /auth/login, /auth/callback, /auth/logout, /auth/profile,
//   /auth/access-token
// NOTE: v4 paths — the Auth0 dashboard callback/logout URLs must use
// /auth/callback, NOT the v3-era /api/auth/callback in the planning docs.
//
// The audience is required, not an optimisation. Without it Auth0 issues an
// OPAQUE access token — a reference string, not a JWT — and the API rejects
// every request before it reaches signature verification. The symptom looks
// like broken authentication rather than missing configuration, which makes it
// slow to diagnose backwards from a 401.
//
// Requesting it tells Auth0 the token is for the NestJS API, which is what
// makes it a JWT carrying `aud: https://api.nahuat.com` — the value
// JwtStrategy checks.
export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
  },
});
