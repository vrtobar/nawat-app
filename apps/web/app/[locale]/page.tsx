import Link from 'next/link';

import { auth } from '../../auth';
import { getMe } from '../../lib/api/admin';
import { isLocale, type Locale } from '../../lib/locale';

// TODO: real landing page — hero, dictionary search entry point. This is still
// a placeholder for everything except the two links below.

const STRINGS = {
  es: {
    tagline: 'Preservando el idioma nawat de El Salvador. Muy pronto.',
    dictionary: 'Ver el diccionario',
    admin: 'Panel de administración',
  },
  en: {
    tagline: 'Preserving the Nawat language of El Salvador. Coming soon.',
    dictionary: 'Browse the dictionary',
    admin: 'Admin panel',
  },
} as const satisfies Record<Locale, Record<string, string>>;

// Whether to offer the panel, which is a question only the API can answer.
//
// The session does not carry role and deliberately does not — it is resolved
// from the database per request (ADR 13), so the only way to know is to ask.
// Called ONLY when a session exists, so an anonymous visit costs no request.
//
// A failure here is not a reason to fail the landing page: the panel enforces
// its own rank anyway, so the worst case of guessing wrong is a link that is
// absent. Absent is the safe direction — the alternative is an error page for
// someone who wanted the tagline.
async function canSeeAdminPanel(): Promise<boolean> {
  const session = await auth();
  if (!session || session.error) return false;

  try {
    const role = (await getMe()).role;
    return role === 'CONTRIBUTOR' || role === 'ADMIN';
  } catch {
    return false;
  }
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // The layout above has already rejected anything else; this narrows the type
  // rather than re-validating, and falls back rather than throwing a second time.
  const t = STRINGS[isLocale(locale) ? locale : 'es'];
  const showAdmin = await canSeeAdminPanel();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold">Nawat</h1>
      <p className="max-w-md text-center text-gray-600">{t.tagline}</p>

      <div className="mt-2 flex items-center gap-4 text-sm">
        <Link href={`/${locale}/dictionary`} className="font-medium underline">
          {t.dictionary}
        </Link>
        {/* Unprefixed: /admin sits outside [locale] on purpose — see the note in
            app/admin/layout.tsx. */}
        {showAdmin && (
          <Link href="/admin" className="font-medium underline">
            {t.admin}
          </Link>
        )}
      </div>
    </main>
  );
}
