import '../globals.css';

import { notFound } from 'next/navigation';

import { isLocale, LOCALES } from '../../lib/locale';

// Prerender both locales. generateStaticParams also fixes the set: any other
// [locale] value falls through to notFound() below rather than being served as
// a default, so a bad URL is a visible 404, not silently wrong content.
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
      <body>{children}</body>
    </html>
  );
}
