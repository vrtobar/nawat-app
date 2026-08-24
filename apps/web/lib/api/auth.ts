import { auth0 } from '../auth0';

// The access token for the current session, for server-side calls to the API.
//
// WHERE THIS IS SAFE TO CALL. Server Components, Server Actions and Route
// Handlers — never the browser. The token is a bearer credential for the whole
// API surface; the client never needs it, because every call to the API happens
// on this side of the network (API_URL is private and the ECS task is the only
// thing that can reach it).
//
// A CAVEAT FROM THE SDK, worth knowing before this spreads. Server Components
// cannot set cookies, so if the access token has expired, calling this in one
// refreshes it and then FAILS TO PERSIST the refreshed token — the next render
// refreshes again. It is correct, just wasteful, and it is why mutations belong
// in Server Actions, which can persist. If authed Server Component reads ever
// become hot, the fix the SDK documents is refreshing in the middleware
// (proxy.ts) instead.
export async function getApiToken(): Promise<string> {
  const { token } = await auth0.getAccessToken();
  return token;
}
