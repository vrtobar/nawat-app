import { type NextRequest, NextResponse } from 'next/server';

import { auth0 } from './lib/auth0';
import { LOCALE_COOKIE, LOCALES, resolveLocale } from './lib/locale';

// Next.js 16: proxy.ts replaces middleware.ts. Two jobs compose here — the Auth0
// SDK's session/route middleware, and a locale redirect that sends a
// locale-less page request to /<locale>/… so every rendered page has an explicit
// locale in its URL. That keeps pages cacheable, shareable, and crawlable rather
// than varying content by a header at one URL (the same URL-identity reasoning
// as ADR 16, applied to i18n).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Three prefixes skip the locale redirect and go straight to the SDK
  // middleware. /auth/* is mounted by the SDK and would break the login
  // round-trip if /auth/callback became /es/auth/callback. /api/* is never
  // localized. /admin/* is the authoring panel, which is deliberately not
  // localized either: it is staff tooling, and translating it would double the
  // copy for an audience that reads the language it is written in.
  //
  // They still run auth0.middleware — skipping the locale redirect is not
  // skipping the session. /admin needs the session most of all.
  if (
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/admin')
  ) {
    return auth0.middleware(request);
  }

  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (!hasLocale) {
    const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = resolveLocale(cookie, request.headers.get('accept-language'));
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  return auth0.middleware(request);
}

// /api/health is EXCLUDED from the matcher, not merely permitted by it. The ALB
// probe carries no credentials; excluding the path keeps a future
// redirect-unauthenticated rule from turning every health probe into a 307 and
// rolling back a working deploy — the same reasoning as @Public() on the API's
// health controller (ADR 13).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/health).*)'],
};
