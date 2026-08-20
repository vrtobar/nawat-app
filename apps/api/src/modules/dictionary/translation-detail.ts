import { Prisma } from '@nahuat/database';
import { type Locale, type TranslationDetail } from '@nahuat/shared';

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
