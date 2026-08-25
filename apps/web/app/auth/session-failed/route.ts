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

  const destination = new URL(`/${locale}`, request.nextUrl.origin);
  destination.searchParams.set('auth_error', code);

  const response = NextResponse.redirect(destination.toString());

  // The session cookie is chunked when it exceeds the browser's per-cookie
  // limit — __session, then __session.0, __session.1 and so on — so deleting
  // the base name alone would leave a partial session behind. The chunk count
  // is not knowable here, so clear generously; deleting a cookie that was never
  // set is a no-op.
  response.cookies.delete('__session');
  for (let chunk = 0; chunk < 10; chunk += 1) {
    response.cookies.delete(`__session.${chunk}`);
  }

  return response;
}
