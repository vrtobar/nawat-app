'use client';

import type { Locale } from '@nahuat/shared';
import { useSearchParams } from 'next/navigation';

// Matches the codes set by the onCallback hook in lib/auth0.ts.
const COPY = {
  es: {
    denied: 'No se completó el inicio de sesión porque no se otorgó el permiso.',
    failed: 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.',
  },
  en: {
    denied: 'Sign-in was not completed because permission was not granted.',
    failed: 'Sign-in could not be completed. Please try again.',
  },
} as const;

// Renders the outcome of a failed login.
//
// A client component because the message comes from the query string, and a
// layout receives no searchParams — only pages do, and the header has to work
// on every page. useSearchParams is the supported way to read them from a
// component that is not a page.
//
// Nothing sensitive crosses to the browser: the only input is a two-value code
// this application put in the URL itself.
export function AuthNotice({ locale }: { locale: Locale }) {
  const code = useSearchParams().get('auth_error');
  if (code !== 'denied' && code !== 'failed') return null;

  return (
    <p role="status" className="bg-amber-50 px-6 py-2 text-sm text-amber-900">
      {COPY[locale][code]}
    </p>
  );
}
