'use client';

import type { Locale } from '@nahuat/shared';
import { useSearchParams } from 'next/navigation';

// Matches the codes set by the onCallback hook in lib/auth0.ts, and the API
// error codes it forwards for a refusal that retrying cannot fix.
const COPY = {
  es: {
    denied: 'No se completó el inicio de sesión porque no se otorgó el permiso.',
    failed: 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.',
    EMAIL_ALREADY_REGISTERED:
      'Ya existe una cuenta con este correo. Inicia sesión de la misma forma que la primera vez.',
    USER_DEACTIVATED: 'Esta cuenta está desactivada.',
  },
  en: {
    denied: 'Sign-in was not completed because permission was not granted.',
    failed: 'Sign-in could not be completed. Please try again.',
    EMAIL_ALREADY_REGISTERED:
      'An account already exists for this email address. Sign in the way you did the first time.',
    USER_DEACTIVATED: 'This account has been deactivated.',
  },
} as const;

type NoticeCode = keyof (typeof COPY)['en'];

const isNoticeCode = (code: string | null): code is NoticeCode => code !== null && code in COPY.en;

// Renders the outcome of a failed login.
//
// A client component because the message comes from the query string, and a
// layout receives no searchParams — only pages do, and the header has to work
// on every page. useSearchParams is the supported way to read them from a
// component that is not a page.
//
// Nothing sensitive crosses to the browser: the only input is a code from a
// closed set this application put in the URL itself, and anything outside that
// set renders nothing.
//
// EMAIL_ALREADY_REGISTERED deliberately does not name the connection that owns
// the address — the API withholds it so the response cannot confirm that a
// given email is registered, and repeating it here would leak what the API
// protected.
export function AuthNotice({ locale }: { locale: Locale }) {
  const code = useSearchParams().get('auth_error');
  if (!isNoticeCode(code)) return null;

  return (
    <p role="status" className="bg-amber-50 px-6 py-2 text-sm text-amber-900">
      {COPY[locale][code]}
    </p>
  );
}
