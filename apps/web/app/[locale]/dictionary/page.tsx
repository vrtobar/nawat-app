import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { browseEntries, searchEntries } from '../../../lib/api/dictionary';
import { isLocale, type Locale } from '../../../lib/locale';
import { DictionarySearchInput } from './search-input';

// UI-chrome strings, inline per locale. A full message system (next-intl) is
// deferred; the handful of strings here do not justify it yet, and the content
// itself — the entries — is already localized server-side by the API.
const STRINGS = {
  es: {
    title: 'Diccionario',
    all: 'Todo',
    words: 'Palabras',
    expressions: 'Expresiones',
    placeholder: 'Buscar en nawat…',
    empty: 'No se encontraron entradas.',
    prev: '← Anterior',
    next: 'Siguiente →',
    page: 'Página',
    of: 'de',
    expression: 'expresión',
  },
  en: {
    title: 'Dictionary',
    all: 'All',
    words: 'Words',
    expressions: 'Expressions',
    placeholder: 'Search Nawat…',
    empty: 'No entries found.',
    prev: '← Previous',
    next: 'Next →',
    page: 'Page',
    of: 'of',
    expression: 'expression',
  },
} as const satisfies Record<Locale, Record<string, string>>;

type SearchParams = { q?: string; type?: string; page?: string };

function hrefFor(locale: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) if (val) sp.set(key, val);
  const qs = sp.toString();
  return `/${locale}/dictionary${qs ? `?${qs}` : ''}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const title = isLocale(locale) ? STRINGS[locale].title : 'Dictionary';
  return { title };
}

export default async function DictionaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;

  const t = STRINGS[locale];
  const q = sp.q?.trim() || undefined;
  const type = sp.type === 'WORD' || sp.type === 'EXPRESSION' ? sp.type : undefined;
  const page = Number(sp.page) > 0 ? Math.floor(Number(sp.page)) : 1;

  const { data, meta } = q
    ? await searchEntries({ locale, q, type, page })
    : await browseEntries({ locale, type, page });

  const facets = [
    { label: t.all, value: undefined },
    { label: t.words, value: 'WORD' as const },
    { label: t.expressions, value: 'EXPRESSION' as const },
  ];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">{t.title}</h1>

      <Suspense fallback={null}>
        <DictionarySearchInput placeholder={t.placeholder} />
      </Suspense>

      <nav className="mt-4 flex gap-2" aria-label="Filter by type">
        {facets.map((facet) => {
          const active = type === facet.value;
          return (
            <Link
              key={facet.label}
              href={hrefFor(locale, { q, type: facet.value })}
              aria-current={active ? 'true' : undefined}
              className={`rounded-full px-3 py-1 text-sm ${
                active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {facet.label}
            </Link>
          );
        })}
      </nav>

      {data.length === 0 ? (
        <p className="mt-8 text-gray-500">{t.empty}</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-100">
          {data.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/${locale}/dictionary/${entry.slug}`}
                className="flex items-baseline justify-between gap-4 py-3 hover:bg-gray-50"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-lg font-medium">{entry.nawatContent}</span>
                  {entry.type === 'EXPRESSION' && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      {t.expression}
                    </span>
                  )}
                </span>
                <span className="text-right text-gray-600">{entry.primaryTranslation.content}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {meta.totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-between" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={hrefFor(locale, { q, type, page: String(page - 1) })}
              className="text-sm text-gray-700 hover:underline"
            >
              {t.prev}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-gray-500">
            {t.page} {meta.page} {t.of} {meta.totalPages}
          </span>
          {page < meta.totalPages ? (
            <Link
              href={hrefFor(locale, { q, type, page: String(page + 1) })}
              className="text-sm text-gray-700 hover:underline"
            >
              {t.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
