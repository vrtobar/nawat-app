import { NextResponse } from 'next/server';

import { auth } from './auth';
import { LOCALE_COOKIE, LOCALES, resolveLocale } from './lib/locale';

// Next.js 16: proxy.ts replaces middleware.ts. Two jobs compose here — Auth.js's
// session handling, and a locale redirect that sends a locale-less page request
// to /<locale>/… so every rendered page has an explicit locale in its URL. That
// keeps pages cacheable, shareable, and crawlable rather than varying content by
// a header at one URL (the same URL-identity reasoning as ADR 16, applied to
// i18n).
//
// THE LOCALE LOGIC SITS INSIDE auth(), not beside it. Auth.js's middleware is
// that wrapper rather than a function to call, so composing means putting this
// application's logic in the handler it takes — where `request.auth` is also
// available, should a route ever need to branch on it.
//
// ⚠️ THIS IS THE ONE PLACE A ROTATED REFRESH TOKEN CAN BE PERSISTED. The `jwt`
// callback refreshes whenever the session is read, but a Server Component
// cannot set cookies, so a refresh triggered there is computed and then thrown
// away — and because refresh tokens are single-use, the next read would present
// the same spent token and the API would revoke the session as reuse. Running
// on every matched request means the refresh almost always happens here, in a
// response that can carry the new cookie. See lib/api/auth.ts.
//
// THE /auth/session-failed EXEMPTION IS GONE, and its absence is the point.
// That path was excluded because the Auth0 SDK rolled the session cookie back
// onto any response it did not itself handle — "simply touch the sessions if
// rolling sessions are enabled" — which silently undid the deletion that route
// existed to perform. Nothing deletes cookies any more, because Auth.js fails a
// sign-in before writing one.
export const proxy = auth((request) => {
  const { pathname } = request.nextUrl;

  // Three prefixes skip the locale redirect. /auth/* is mounted by Auth.js and
  // would break the login round trip if /auth/callback/google became
  // /es/auth/callback/google. /api/* is never localized. /admin/* is the
  // authoring panel, deliberately not localized either: it is staff tooling,
  // and translating it would double the copy for an audience that reads the
  // language it is written in.
  //
  // Skipping the redirect is not skipping the session — that already ran, in
  // the wrapper.
  if (
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/admin')
  ) {
    return NextResponse.next();
  }

  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (!hasLocale) {
    const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = resolveLocale(cookie, request.headers.get('accept-language'));
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

// /api/health is EXCLUDED from the matcher, not merely permitted by it. The ALB
// probe carries no credentials; excluding the path keeps a future
// redirect-unauthenticated rule from turning every health probe into a 307 and
// rolling back a working deploy — the same reasoning as @Public() on the API's
// health controller (ADR 13).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/health).*)'],
};
