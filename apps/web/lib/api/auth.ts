import { headers } from 'next/headers';
import { getToken } from 'next-auth/jwt';

// The access token for the current session, for server-side calls to the API.
//
// WHERE THIS IS SAFE TO CALL. Server Components, Server Actions and Route
// Handlers — never the browser. The token is a bearer credential for the whole
// API surface; the client never needs it, because every call to the API happens
// on this side of the network (API_URL is private and the ECS task is the only
// thing that can reach it).
//
// ⚠️ WHY getToken() AND NOT auth(), WHICH THE LIBRARY RECOMMENDS. Whatever the
// `session` callback returns is served to the browser by GET /auth/session, so
// anything auth() can see, a client can fetch. The API tokens must not be in
// that set. getToken() decrypts the cookie and returns the full JWT, including
// the fields deliberately withheld from the session — which is precisely this
// case. Auth.js marks it "not recommended" for AUTHENTICATION, where auth() is
// nicer; reading a server-only claim is what it is for.
//
// A CAVEAT FROM THE SDK, unchanged by the move off Auth0 and worth knowing
// before this spreads. Server Components cannot set cookies, so if the access
// token has expired, calling this in one refreshes it and then FAILS TO PERSIST
// the rotated pair — and because refresh tokens are single-use, the next render
// refreshes again from the same stored token, which the API treats as reuse and
// answers by revoking the session. It is therefore worse here than it was under
// Auth0, where a wasted refresh was merely wasteful. Mutations belong in Server
// Actions, which can persist; if authenticated Server Component reads ever
// become hot, refresh in the middleware (proxy.ts) instead.
export async function getApiToken(): Promise<string> {
  const token = await getToken({
    req: { headers: await headers() },
    secret: process.env.AUTH_SECRET,
    // Auth.js prefixes the cookie with __Secure- when it believes the
    // deployment is HTTPS. Derived from the app's own base URL rather than
    // NODE_ENV: staging and production are both HTTPS, and a local production
    // build over http would otherwise look for a cookie nothing wrote.
    secureCookie: (process.env.APP_BASE_URL ?? '').startsWith('https://'),
  });

  if (!token?.api) {
    // Reached when the cookie is absent, undecryptable, or belongs to a session
    // whose refresh already failed. All three mean the same thing to a caller:
    // there is no credential to send.
    throw new Error('No API token in the current session');
  }

  return token.api.accessToken;
}
