import type { Locale } from '@nahuat/shared';

import { auth } from '../auth';
import { AUTH_ROUTES, withCallback } from '../lib/auth-routes';

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
  // Where the sign-in sends the browser back to. Defaults to the locale's home page
  // rather than the current URL: a server component cannot see the pathname,
  // and threading it through would mean a middleware header on every request
  // for a nicety. Pages that care can pass their own.
  returnTo?: string;
}) {
  const session = await auth();
  const copy = COPY[locale];
  const destination = returnTo ?? `/${locale}`;

  // A SESSION WHOSE REFRESH FAILED IS NOT A SESSION. `error` is set by the jwt
  // callback when the refresh token was revoked, spent, or belongs to a family
  // the API no longer has — and the tokens are dropped from the cookie with it.
  // What remains decrypts, so auth() still returns an object carrying the
  // profile it was issued with, and checking only `!session` greets someone by
  // name while every authenticated request they make fails.
  //
  // No "your session expired" copy. Saying so needs a fifth string and the
  // message catalogue COPY's note defers, and this is the ambient "are you
  // signed in" indicator — the answer is no, and the link is the action. Where
  // a lapsed session actually costs someone mid-task, the admin panel explains
  // it rather than leaving them to infer it from a header.
  if (!session || session.error) {
    return (
      <a
        href={withCallback(AUTH_ROUTES.signIn, destination)}
        className="text-sm font-medium hover:underline"
      >
        {copy.login}
      </a>
    );
  }

  // The profile the API returned, not Google's. `name` is optional because
  // Google does not always supply one, and the API falls back to the email when
  // writing the row — so this only falls through if the session predates a
  // profile being stored at all.
  const label = session.profile?.name ?? session.profile?.email ?? '';

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-gray-600">{label}</span>
      {/*
        A callbackUrl IS passed now, where the Auth0 version could not.

        Auth0 handed logout's destination to the tenant verbatim as
        post_logout_redirect_uri, which had to be absolute and had to appear in
        the tenant's Allowed Logout URLs — a dashboard list this repository
        could not see, and the cause of a failed logout on 2026-08-25. Signing
        out is entirely local now: there is no third party to redirect through
        and no list to be absent from, so a relative path back to the current
        locale simply works.
      */}
      <a
        href={withCallback(AUTH_ROUTES.signOut, destination)}
        className="font-medium hover:underline"
      >
        {copy.logout}
      </a>
    </div>
  );
}
