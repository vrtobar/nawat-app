import { handlers } from '../../../auth';

// Mounts Auth.js's own routes: /auth/signin, /auth/callback/google,
// /auth/signout, /auth/session, /auth/csrf, /auth/providers.
//
// The catch-all sits under /auth rather than the Next.js convention of
// /api/auth because `basePath: '/auth'` says so — see auth.ts. That keeps the
// URLs this app already used, so the Google client's authorized redirect URIs
// and proxy.ts's path prefixes are unchanged by the move off Auth0.
//
// ⚠️ /auth/failed is a PAGE in a sibling directory, not one of these routes. A
// catch-all does not shadow a more specific segment, so both resolve — but the
// two are easy to confuse when adding routes here later.
export const { GET, POST } = handlers;
