import '../globals.css';

import { cookies, headers } from 'next/headers';

import { LOCALE_COOKIE, resolveLocale } from '../../lib/locale';

// WHY THIS EXISTS: /auth/failed had no <html> or <body>.
//
// The root layout is a pass-through that returns `children` — the locale is
// only known inside [locale], so app/[locale]/layout.tsx is what normally
// supplies the document, and app/admin/layout.tsx does the same for the panel.
// /auth is a third top-level branch, deliberately outside both: proxy.ts skips
// the locale redirect for it, because rewriting /auth/callback/google to
// /es/auth/callback/google would break the login round trip.
//
// So the one page under here rendered with no document around it, and Next
// answered a failed sign-in with "Missing <html> and <body> tags in the root
// layout" instead of the explanation the page exists to give. The failure mode
// is unusually unhelpful: the page that says WHY a login was refused is the
// page that cannot render, so the reason is replaced by a framework error at
// exactly the moment someone needs it.
//
// The catch-all beside it — app/auth/[...nextauth]/route.ts — is a route
// handler and unaffected, which is why signin and signout always looked fine.
//
// `lang` is resolved the same way the page resolves its copy: cookie first,
// then Accept-Language. It cannot come from the route, since /auth is the
// branch that has no locale segment.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = resolveLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get('accept-language'),
  );

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
