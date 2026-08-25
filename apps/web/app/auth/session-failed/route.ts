import { type NextRequest, NextResponse } from 'next/server';

import { LOCALE_COOKIE, resolveLocale } from '../../../lib/locale';

// Clears the session the SDK wrote, then sends the user back with a code the
// header can render.
//
// WHY THIS ROUTE EXISTS AT ALL, because it looks redundant. The SDK writes the
// session cookie AFTER onCallback returns, onto whatever response onCallback
// produced:
//
//   const res = await this.onCallback(null, ctx, session);
//   session = await this.finalizeSession(session, id_token);
//   await this.sessionStore.set(req.cookies, res.cookies, session, true);
//
// So a hook that decides the login must not stand cannot prevent the cookie,
// and cannot delete it either — anything it clears is overwritten one line
// later. Redirecting here is the first moment the cookie can actually be
// removed, because this response is built after that write has happened.
//
// Without it the user would hold a session with no account behind it, which is
// exactly the state that creating accounts at login exists to eliminate:
// signed in everywhere, recognised nowhere.
//
// /auth/* is routed to the SDK middleware by proxy.ts, but the SDK matches its
// own routes exactly (login, logout, callback, profile, access-token) and falls
// through for anything else, so this path reaches Next's router.
export function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code') ?? 'failed';

  const locale = resolveLocale(
    request.cookies.get(LOCALE_COOKIE)?.value,
    request.headers.get('accept-language'),
  );

  // APP_BASE_URL, not request.nextUrl.origin.
  //
  // Behind the ALB the inferred origin is the container's own address — a real
  // sign-in on staging redirected to
  // https://ip-10-1-4-216.ec2.internal:3000/en, which the browser cannot
  // resolve. Locally the two are identical, so this can only fail once there is
  // a load balancer in front, and no local test can show it.
  //
  // onCallback already builds its redirects this way; the two now agree.
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const destination = new URL(`/${locale}`, base);
  destination.searchParams.set('auth_error', code);

  const response = NextResponse.redirect(destination.toString());

  // Delete what is actually present rather than guessing names.
  //
  // The session is chunked when it exceeds the per-cookie size limit, and a
  // real Auth0 session — access token plus ID token — does exceed it, so on a
  // deployed environment the base cookie may hold nothing and the chunks hold
  // everything. Guessing the names got this wrong once already: the SDK writes
  // `__session__0` (CHUNK_PREFIX is a double underscore), while `__session.0`
  // is its LEGACY form. Deleting the legacy names removed nothing, the session
  // survived a refused sign-in, and the header greeted the user by name.
  //
  // A fabricated cookie in a local test did not show it, because a hand-written
  // `__session` is exactly the one name that was being deleted correctly.
  //
  // Enumerating the request's own cookies covers both schemes, any number of
  // chunks, and whatever the SDK renames them to next.
  const SESSION_COOKIE = /^__session(__\d+|\.\d+)?$/;
  for (const cookie of request.cookies.getAll()) {
    if (SESSION_COOKIE.test(cookie.name)) {
      response.cookies.delete(cookie.name);
    }
  }

  return response;
}
