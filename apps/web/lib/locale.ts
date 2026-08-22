import { DEFAULT_LOCALE, type Locale, LocaleSchema } from '@nahuat/shared';

// The web app's locale set is the API's — reuse the one definition (ADR 15)
// rather than restate 'es' | 'en' here, so the URL prefix, the API's ?locale=,
// and the content columns can never disagree.
export { DEFAULT_LOCALE, type Locale };
export const LOCALES = LocaleSchema.options;

// The cookie the selector writes so a bare `/` visit honours the last choice
// over Accept-Language. Read in proxy.ts.
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: string): value is Locale {
  return LocaleSchema.safeParse(value).success;
}

// Which locale a locale-less request resolves to: the remembered cookie first
// (a Salvadoran-American may have an English browser but want Spanish), then the
// browser's Accept-Language, then the default. Mirrors the API's @ContentLocale
// order minus the token step, which the public web has no user for.
export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (cookieValue && isLocale(cookieValue)) return cookieValue;
  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((part) => part.split(';')[0]?.trim().slice(0, 2).toLowerCase() ?? '');
  for (const tag of tags) {
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}
