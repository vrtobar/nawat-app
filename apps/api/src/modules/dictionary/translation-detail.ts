import { Prisma } from '@nahuat/database';
import { type AdminTranslationDetail, type Locale, type TranslationDetail } from '@nahuat/shared';

// The full translation shape for a detail response — every field
// TranslationDetail declares, plus its dialect inline so the client needs no
// second lookup. Paired content/example columns are selected and resolved to one
// locale by toTranslationDetail; the S3 keys (audioKey, imageKey) are
// deliberately absent. Shared by the entry detail (translations nested on the
// entry) and the standalone translation write paths, so the projection and its
// mapping cannot drift between them.
export const TRANSLATION_DETAIL_SELECT = {
  id: true,
  contentEs: true,
  contentEn: true,
  exampleNawat: true,
  exampleEs: true,
  exampleEn: true,
  phonetic: true,
  partOfSpeech: true,
  audioUrl: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
  dialect: {
    select: {
      id: true,
      code: true,
      nameEs: true,
      nameEn: true,
      descriptionEs: true,
      descriptionEn: true,
      precedence: true,
    },
  },
} satisfies Prisma.TranslationSelect;

export type TranslationDetailRow = Prisma.TranslationGetPayload<{
  select: typeof TRANSLATION_DETAIL_SELECT;
}>;

// Spanish is mandatory on every translation; English is optional and the read
// queries filter out rows lacking it in the resolved locale. So by the time a
// row reaches here its locale content is present — a null means the query and
// this resolver have drifted apart, surfaced as a 500 rather than smuggled to
// the client as an empty string.
export function resolveContent(
  t: { contentEs: string; contentEn: string | null },
  locale: Locale,
): string {
  const value = locale === 'en' ? t.contentEn : t.contentEs;
  if (value === null) {
    throw new Error(`translation missing ${locale} content despite the renderable filter`);
  }
  return value;
}

// The usage example is optional in both languages, so absence is normal and
// stays null rather than throwing.
export function resolveExample(
  t: { exampleEs: string | null; exampleEn: string | null },
  locale: Locale,
): string | null {
  return (locale === 'en' ? t.exampleEn : t.exampleEs) ?? null;
}

// Maps a translation detail row to the response shape, resolving content and
// example to one locale. exampleNawat is not resolved — Nawat is the subject,
// shown to every learner. locale echoes which language was served.
export function toTranslationDetail(t: TranslationDetailRow, locale: Locale): TranslationDetail {
  return {
    id: t.id,
    content: resolveContent(t, locale),
    example: resolveExample(t, locale),
    locale,
    phonetic: t.phonetic,
    partOfSpeech: t.partOfSpeech,
    exampleNawat: t.exampleNawat,
    audioUrl: t.audioUrl,
    isPublished: t.isPublished,
    dialect: t.dialect,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// The same shape, for the WRITE paths, where the strict resolver above cannot
// be used.
//
// WHY THE STRICT ONE BREAKS HERE. resolveContent throws when the resolved
// locale's column is null, deliberately: on the read paths the query filters
// English-less rows out before the resolver sees them, so a null there really
// would mean the query and the resolver had drifted apart. The write paths have
// no such filter and cannot have one — they answer with ONE translation, so
// filtering it out would leave nothing to return. The result was a 500 on an
// ordinary action: adding or editing a Spanish-only translation with the locale
// resolved to English threw AFTER the row had already been written, so the
// author saw an error and the change existed anyway. Reachable by any caller,
// not only an English-preference one, since ?locale= wins over every other
// input to @ContentLocale.
//
// So this one falls back instead of throwing, and reports WHICH LANGUAGE IT
// SERVED in `locale` — the field that exists to answer exactly that question.
// contentEs is mandatory on every translation, so there is always something to
// serve and the fallback cannot itself fail.
//
// The strict resolver is left alone on purpose. It guards a real invariant on
// the read paths, and softening it there to fix a bug here would trade a
// visible failure for a silent one.
export function toWrittenTranslationDetail(
  t: TranslationDetailRow,
  preferred: Locale,
): TranslationDetail {
  const hasPreferred = preferred === 'en' ? t.contentEn !== null : true;
  const served: Locale = hasPreferred ? preferred : 'es';

  return {
    ...toTranslationDetail(t, served),
    locale: served,
  };
}

// The admin projection. Same columns as TRANSLATION_DETAIL_SELECT — the
// difference is entirely in the mapping, which hands both languages back
// instead of resolving one. Declared separately rather than aliased so that
// adding a column for one surface is a deliberate choice about the other:
// these two shapes answer to different audiences and are expected to diverge.
export const ADMIN_TRANSLATION_SELECT = {
  id: true,
  contentEs: true,
  contentEn: true,
  exampleNawat: true,
  exampleEs: true,
  exampleEn: true,
  phonetic: true,
  partOfSpeech: true,
  audioUrl: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
  dialect: {
    select: {
      id: true,
      code: true,
      nameEs: true,
      nameEn: true,
      descriptionEs: true,
      descriptionEn: true,
      precedence: true,
    },
  },
} satisfies Prisma.TranslationSelect;

export type AdminTranslationRow = Prisma.TranslationGetPayload<{
  select: typeof ADMIN_TRANSLATION_SELECT;
}>;

// Maps a translation row for the editor. No resolveContent call and no locale
// argument: every paired column is handed over as stored, which is what lets the
// form PATCH back exactly the field names it received. contentEs is non-null in
// the schema; contentEn genuinely may be absent, and the editor renders that as
// an empty field to fill rather than an error.
export function toAdminTranslationDetail(t: AdminTranslationRow): AdminTranslationDetail {
  return {
    id: t.id,
    contentEs: t.contentEs,
    contentEn: t.contentEn,
    exampleNawat: t.exampleNawat,
    exampleEs: t.exampleEs,
    exampleEn: t.exampleEn,
    phonetic: t.phonetic,
    partOfSpeech: t.partOfSpeech,
    audioUrl: t.audioUrl,
    isPublished: t.isPublished,
    dialect: t.dialect,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
