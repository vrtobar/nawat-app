import {
  DialectSchema,
  DictionaryEntryDetailSchema,
  DictionaryEntryListItemSchema,
  type DictionaryEntryType,
  type Locale,
} from '@nahuat/shared';
import { z } from 'zod';

import { fetchItem, fetchPage } from './client';

type ListParams = { locale: Locale; type?: DictionaryEntryType; page?: number };

// GET /entries — structured browse, alphabetical by headword. The API fences the
// public dictionary to WORD/EXPRESSION; type narrows within that.
export function browseEntries({ locale, type, page }: ListParams) {
  return fetchPage('/entries', DictionaryEntryListItemSchema, { locale, type, page });
}

// GET /entries/search — pg_trgm fuzzy search, accent-insensitive. q is required.
export function searchEntries({ locale, q, type, page }: ListParams & { q: string }) {
  return fetchPage('/entries/search', DictionaryEntryListItemSchema, { locale, q, type, page });
}

// GET /entries/by-slug/:slug — the canonical detail path behind /dictionary/[slug].
export function getEntryBySlug(slug: string, locale: Locale) {
  return fetchItem(`/entries/by-slug/${encodeURIComponent(slug)}`, DictionaryEntryDetailSchema, {
    locale,
  });
}

// GET /dialects — every dialect, precedence ascending. Public and unpaginated:
// the route is @Public and answers with a plain array, so this is fetchItem
// over z.array rather than fetchPage, which would look for a meta block that
// is not there.
//
// Anonymous despite backing an authenticated form. The dialect list is
// reference data with nothing user-specific in it, and reading it with a token
// would only tie a cacheable, identical-for-everyone response to a session.
export function listDialects() {
  return fetchItem('/dialects', z.array(DialectSchema));
}
