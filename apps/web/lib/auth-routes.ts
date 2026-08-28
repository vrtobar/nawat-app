// The auth routes, in one place.
//
// WHY THIS EXISTS: on 2026-08-28 the admin panel's "Log out" link still pointed
// at `/auth/logout`, which the Auth0 SDK mounted and Auth.js does not. Auth.js's
// catch-all received it, did not recognise the action, and returned `Bad
// request` as JSON — so the button rendered the browser's JSON viewer instead of
// signing anyone out. Nothing caught it: these are string literals in href
// attributes, invisible to the typechecker and to every test.
//
// The names come from the LIBRARY, not from this application — Auth.js mounts
// signin, signout, callback/<provider>, session, csrf and providers beneath
// `basePath`. So they will change again if the provider changes again, and the
// point of this module is that such a change is one edit rather than a search.
//
// `/auth/failed` is ours: it is a page in app/auth/failed, named by
// `pages.error` in auth.ts.
const BASE = '/auth';

export const AUTH_ROUTES = {
  // GET renders Auth.js's own confirmation page; the sign-out itself is a
  // CSRF-protected POST from that page. A plain link is therefore two clicks,
  // which is the library's default and deliberate — a one-click GET logout is
  // triggerable by any <img> tag on any page.
  signIn: `${BASE}/signin`,
  signOut: `${BASE}/signout`,
  failed: `${BASE}/failed`,
} as const;

// Where to return after the round trip. Relative on purpose: it is resolved
// against AUTH_URL, and an absolute URL would have to be listed somewhere.
export function withCallback(route: string, callbackUrl: string): string {
  return `${route}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
