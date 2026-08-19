import { z } from 'zod';

// -----------------------------------------------------------------------------
// LOCALE
// Which language content is served in. Spanish and English only — see ADR 15.
//
// Nawat is deliberately not a locale. It is the subject being taught, shown to
// every learner whatever language they read, so it is never a value selected
// between. That is also why the Nawat-bearing fields are named nawatContent
// and exampleNawat rather than contentNawat: the suffix form marks membership
// in this set, and Nawat is not a member.
//
// THREE CASINGS, ON PURPOSE. They are listed here so nobody has to rediscover
// which one applies where:
//
//   'es' / 'en'   wire format — `?locale=es`, and the locale field on any
//                 response. Lowercase because that is what language tags look
//                 like everywhere else.
//   ES / EN       the Postgres enum on users.locale. Uppercase to match Role,
//                 EntryType and every other enum in schema.prisma.
//   Es / En       the column suffix — contentEs, titleEn. Capitalized because
//                 it sits mid-identifier.
//
// This file owns the first and the third. The second is mapped in the API,
// in common/locale.ts, where Prisma types are in scope — this package never
// imports them.
// -----------------------------------------------------------------------------

export const LocaleSchema = z.enum(['es', 'en']);

export type Locale = z.infer<typeof LocaleSchema>;

// What makes locale resolution one expression instead of a mapping per field:
//
//   row[`content${LOCALE_FIELD_SUFFIX[locale]}`]
//
// Typed through template literal types, so a field that does not exist in both
// languages fails to compile rather than returning undefined at runtime.
export const LOCALE_FIELD_SUFFIX = {
  es: 'Es',
  en: 'En',
} as const satisfies Record<Locale, string>;

export type LocaleFieldSuffix = (typeof LOCALE_FIELD_SUFFIX)[Locale];

// Resolution order is server-side: explicit ?locale= → User.locale →
// Accept-Language → this. A user's stored choice beats their browser's,
// because a Salvadoran-American may well have an English browser and want
// Spanish. Public dictionary browsing has no user, which is why the header and
// this default stay in the chain.
export const DEFAULT_LOCALE: Locale = 'es';
