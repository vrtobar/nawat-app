import { cookies, headers } from 'next/headers';
import Link from 'next/link';

import { LOCALE_COOKIE, resolveLocale } from '../../../lib/locale';

// Where Auth.js sends a failed sign-in (`pages.error` in auth.ts).
//
// REPLACES /auth/session-failed, which was a route handler rather than a page
// and existed to DELETE COOKIES. The Auth0 SDK wrote its session after the
// callback hook returned, so a hook refusing a login could not prevent one —
// the only moment the cookie could be removed was a later request, which meant
// redirecting to a route that enumerated cookie names and chunk suffixes to
// clear them.
//
// None of that is needed now. An error thrown in the `jwt` callback fails the
// sign-in before Auth.js writes anything, so there is no session to clean up
// and this can be an ordinary page that explains what happened.
const COPY = {
  es: {
    title: 'No se pudo iniciar sesión',
    retry: 'Volver a intentar',
    home: 'Volver al inicio',
    reasons: {
      EMAIL_ALREADY_REGISTERED:
        'Ya existe una cuenta con este correo. Inicia sesión como lo hiciste la primera vez.',
      USER_DEACTIVATED: 'Esta cuenta está desactivada.',
      EMAIL_NOT_VERIFIED: 'Esta cuenta de Google no tiene un correo verificado.',
      failed: 'Algo salió mal. Vuelve a intentarlo.',
    },
  },
  en: {
    title: 'Could not sign you in',
    retry: 'Try again',
    home: 'Back to home',
    reasons: {
      EMAIL_ALREADY_REGISTERED:
        'An account already exists for this email address. Sign in the way you did the first time.',
      USER_DEACTIVATED: 'This account has been deactivated.',
      EMAIL_NOT_VERIFIED: 'This Google account has no verified email address.',
      failed: 'Something went wrong. Please try again.',
    },
  },
} as const;

export default async function AuthFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const locale = resolveLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get('accept-language'),
  );
  const copy = COPY[locale];

  // A permanent refusal names itself; everything else is indistinguishable from
  // the user's side and says only "try again". The named codes match
  // PERMANENT_SIGNIN_FAILURES in auth.ts.
  const reason =
    error && error in copy.reasons
      ? copy.reasons[error as keyof typeof copy.reasons]
      : copy.reasons.failed;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">{copy.title}</h1>
      <p className="text-gray-600">{reason}</p>
      <div className="flex gap-4 text-sm font-medium">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
            /auth/signin is an Auth.js route, not a page; <Link> would attempt a
            client-side transition to a route that does not exist. */}
        <a href="/auth/signin" className="hover:underline">
          {copy.retry}
        </a>
        <Link href={`/${locale}`} className="hover:underline">
          {copy.home}
        </Link>
      </div>
    </main>
  );
}
