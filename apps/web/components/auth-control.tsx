import type { Locale } from '@nahuat/shared';

import { auth0 } from '../lib/auth0';

// Four strings, inlined. The app has no message catalogue yet — the landing
// page's copy is hardcoded too — and introducing one for a login link would be
// the tail wagging the dog. Worth replacing the moment a third consumer appears.
const COPY = {
  es: { login: 'Iniciar sesión', logout: 'Cerrar sesión' },
  en: { login: 'Log in', logout: 'Log out' },
} as const;

// The signed-in state, rendered server-side.
//
// THIS MAKES ITS PARENT DYNAMIC. Reading the session reads cookies, which opts
// the route out of static rendering — including the landing page, which was
// prerendered for both locales. Accepted deliberately: the dictionary pages
// already fetch per request, so only the landing page changes, and a header
// that lies about whether you are signed in is worth less than a prerendered
// placeholder. Partial prerendering would recover it if that ever matters.
//
// No role here. Role lives on the API side now and is read from the database
// per request; nothing about it belongs in a login button.
export async function AuthControl({
  locale,
  returnTo,
}: {
  locale: Locale;
  // Where Auth0 sends the browser back to. Defaults to the locale's home page
  // rather than the current URL: a server component cannot see the pathname,
  // and threading it through would mean a middleware header on every request
  // for a nicety. Pages that care can pass their own.
  returnTo?: string;
}) {
  const session = await auth0.getSession();
  const copy = COPY[locale];
  const destination = returnTo ?? `/${locale}`;
  const target = encodeURIComponent(destination);

  if (!session) {
    return (
      <a href={`/auth/login?returnTo=${target}`} className="text-sm font-medium hover:underline">
        {copy.login}
      </a>
    );
  }

  // `name` is optional on the ID token — email OTP supplies none — and email is
  // optional in the SDK's type even though every connection in use returns one.
  // Falling through to `sub` keeps this from rendering an empty string, which
  // would look like a broken header rather than a signed-in one.
  const label = session.user.name ?? session.user.email ?? session.user.sub;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-gray-600">{label}</span>
      <a href={`/auth/logout?returnTo=${target}`} className="font-medium hover:underline">
        {copy.logout}
      </a>
    </div>
  );
}
