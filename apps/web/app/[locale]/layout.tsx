import '../globals.css';

import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AuthControl } from '../../components/auth-control';
import { AuthNotice } from '../../components/auth-notice';
import { isLocale, LOCALES } from '../../lib/locale';

// Fixes the locale set: any other [locale] value falls through to notFound()
// below rather than being served as a default, so a bad URL is a visible 404
// and not silently wrong content.
//
// It no longer prerenders anything. AuthControl reads the session, which reads
// cookies, which opts this layout and everything under it into dynamic
// rendering. That is the deliberate price of a header that knows whether you
// are signed in — see the note in auth-control.tsx.
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale}>
      <body>
        {/* Minimal on purpose: this branch adds a way to sign in, not a
            navigation design. The brand is a plain link home so the header is
            not a bare login button floating in the corner. */}
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <a href={`/${locale}`} className="font-semibold">
            Nawat
          </a>
          <AuthControl locale={locale} />
        </header>
        {/* Suspense because useSearchParams suspends. The layout is already
            dynamic, so this costs nothing today, but without it any future
            attempt to prerender a route under here fails to build. */}
        <Suspense fallback={null}>
          <AuthNotice locale={locale} />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
