import { z } from 'zod';

import { DialectSchema } from './dialect.schema';

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
  'PHRASE',
  'OTHER',
]);

export type PartOfSpeech = z.infer<typeof PartOfSpeechSchema>;

// -----------------------------------------------------------------------------
// TRANSLATION DETAIL
// Used within DictionaryEntryDetail and standalone in flashcard/exercise views.
// Includes dialect inline — avoids a separate lookup.
// audioKey and imageKey intentionally excluded — S3 keys are internal only.
// -----------------------------------------------------------------------------

export const TranslationDetailSchema = z.object({
  id: z.string(),
  contentEs: z.string(),
  contentEn: z.string().nullable(),
  phonetic: z.string().nullable(),
  partOfSpeech: PartOfSpeechSchema.nullable(),
  exampleNawat: z.string().nullable(),
  exampleEs: z.string().nullable(),
  exampleEn: z.string().nullable(),
  audioUrl: z.url().nullable(),
  priority: z.number().int(),
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
// at creation, immutable after).
// priority has no default here — the service resolves the next free
// priority per (entry, dialect); the DB enforces uniqueness on that
// triple (see schema.prisma Translation model).
// -----------------------------------------------------------------------------

export const CreateTranslationSchema = z.object({
  dialectCode: z.string(),
  contentEs: z.string().min(1),
  contentEn: z.string().optional(),
  phonetic: z.string().optional(),
  partOfSpeech: PartOfSpeechSchema.optional(),
  exampleNawat: z.string().optional(),
  exampleEs: z.string().optional(),
  exampleEn: z.string().optional(),
  audioUrl: z.url().optional(),
  priority: z.number().int().min(1).optional(),
});

// PATCH — all fields optional; dialect is immutable after creation
export const UpdateTranslationSchema = CreateTranslationSchema.omit({
  dialectCode: true,
}).partial();

export type CreateTranslation = z.infer<typeof CreateTranslationSchema>;
export type UpdateTranslation = z.infer<typeof UpdateTranslationSchema>;
