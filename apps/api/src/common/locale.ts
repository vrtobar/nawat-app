import type { Locale } from '@nahuat/shared';

// Prisma stores the locale enum as ES/EN; the wire format is es/en (the three
// casings are documented in locale.schema.ts). This is the single place they
// meet on the API side — @nahuat/shared cannot own it, because it must never
// import Prisma types. A Record rather than .toLowerCase() so adding a locale
// to schema.prisma fails to compile here instead of silently passing an
// unhandled value through to the wire.
export const LOCALE_TO_WIRE: Record<'ES' | 'EN', Locale> = {
  ES: 'es',
  EN: 'en',
};
