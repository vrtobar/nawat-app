import { z } from 'zod';

import { DialectSchema } from './dialect.schema';
import { LocaleSchema } from './locale.schema';

// -----------------------------------------------------------------------------
// ENUMS
// Defined here and re-exported — avoids duplication with Prisma enums which
// are internal to apps/api only.
// -----------------------------------------------------------------------------

export const PartOfSpeechSchema = z.enum([
  'NOUN',
  'VERB',
  'ADJECTIVE',
  'ADVERB',
  'PRONOUN',
  'PARTICLE',
  'PREPOSITION',
  'CONJUNCTION',
  'OTHER',
]);

export type PartOfSpeech = z.infer<typeof PartOfSpeechSchema>;

// -----------------------------------------------------------------------------
// TRANSLATION DETAIL
// Used within DictionaryEntryDetail and standalone in flashcard/exercise views.
// Includes dialect inline — avoids a separate lookup.
// audioKey and imageKey intentionally excluded — S3 keys are internal only.
//
// RESOLVED CONTENT (ADR 0015 §4). This is a response shape, so `content` and
// `example` are already resolved to one locale server-side — never both
// languages for the client to pick between. Filtering per locale has to be
// server-side for pagination to stay correct, so resolution is too. `content`
// is non-null because a row lacking the resolved locale is filtered out before
// it reaches here; `example` may still be absent in that locale. `locale`
// echoes which language was served — useful when it was resolved from
// Accept-Language or the default rather than an explicit ?locale=, since then
// the client does not otherwise know. The paired columns live only on the
// write DTOs below, where a contributor supplies both.
//
// exampleNawat is not resolved — Nawat is the subject, shown to every learner.
// -----------------------------------------------------------------------------

export const TranslationDetailSchema = z.object({
  id: z.string(),
  content: z.string(),
  example: z.string().nullable(),
  locale: LocaleSchema,
  phonetic: z.string().nullable(),
  partOfSpeech: PartOfSpeechSchema.nullable(),
  exampleNawat: z.string().nullable(),
  audioUrl: z.url().nullable(),
  isPublished: z.boolean(),
  dialect: DialectSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type TranslationDetail = z.infer<typeof TranslationDetailSchema>;

// -----------------------------------------------------------------------------
// CREATE / UPDATE DTOs
// No entryId in the body — shallow nesting: POST /entries/:entryId/translations,
// the parent entry comes from the path. dialectCode stays in the body (chosen
// at creation, immutable after) and is unique per entry: a dialect has at most
// one translation of a word.
//
// A word with several senses is ONE translation with a pipe-separated gloss —
// "hombre | persona" — not several rows. The dictionary backs a learner's
// recall, so a card prompts the whole word; splitting senses into rows would
// make "takat → ?" ambiguous to grade and buys nothing the gloss does not.
// -----------------------------------------------------------------------------

export const CreateTranslationSchema = z.object({
  dialectCode: z.string(),
  // Spanish gloss; multiple senses pipe-separated, e.g. "hombre | persona".
  contentEs: z.string().min(1),
  contentEn: z.string().optional(),
  phonetic: z.string().optional(),
  partOfSpeech: PartOfSpeechSchema.optional(),
  exampleNawat: z.string().optional(),
  exampleEs: z.string().optional(),
  exampleEn: z.string().optional(),
  audioUrl: z.url().optional(),
});

// PATCH — all fields optional; dialect is immutable after creation
export const UpdateTranslationSchema = CreateTranslationSchema.omit({
  dialectCode: true,
}).partial();

export type CreateTranslation = z.infer<typeof CreateTranslationSchema>;
export type UpdateTranslation = z.infer<typeof UpdateTranslationSchema>;

// -----------------------------------------------------------------------------
// ADMIN TRANSLATION DETAIL
// Used only by the authenticated admin read surface (GET /admin/entries/:id),
// which backs the entry editor.
//
// UNRESOLVED CONTENT — the deliberate inverse of TranslationDetail above. That
// shape resolves to one locale because a learner reads one language and
// pagination has to filter server-side. An editor is the one client that needs
// both: it prefills a form whose fields ARE contentEs and contentEn, so a
// resolved shape cannot round-trip through it. Before this existed no endpoint
// returned both languages of a row — the paired columns appeared only on the
// write DTOs, so a client could send them and never read them back.
//
// The field names match CreateTranslationSchema exactly (contentEs/contentEn,
// exampleEs/exampleEn) rather than the resolved content/example. That is the
// point: the editor PATCHes back the same field names it received, so no
// mapping layer sits between the form and UpdateTranslationSchema where a
// rename could silently drop a field.
//
// No `locale` field, because nothing was resolved. audioKey/imageKey stay
// excluded — S3 keys are internal regardless of who is asking.
// -----------------------------------------------------------------------------

export const AdminTranslationDetailSchema = z.object({
  id: z.string(),
  contentEs: z.string(),
  contentEn: z.string().nullable(),
  exampleNawat: z.string().nullable(),
  exampleEs: z.string().nullable(),
  exampleEn: z.string().nullable(),
  phonetic: z.string().nullable(),
  partOfSpeech: PartOfSpeechSchema.nullable(),
  audioUrl: z.url().nullable(),
  isPublished: z.boolean(),
  dialect: DialectSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type AdminTranslationDetail = z.infer<typeof AdminTranslationDetailSchema>;
