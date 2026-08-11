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
// TODO(PLAN §13): pass authorizationParameters.audience here so access
// tokens are minted for the NestJS API (AUTH0_AUDIENCE).
export const auth0 = new Auth0Client();
