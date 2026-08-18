import { z } from 'zod';

import { PaginationParamsSchema } from './api-response.schema';
import { PartOfSpeechSchema, TranslationDetailSchema } from './translation.schema';

// -----------------------------------------------------------------------------
// ENUMS
// -----------------------------------------------------------------------------

export const EntryTypeSchema = z.enum(['WORD', 'PHRASE']);
export type EntryType = z.infer<typeof EntryTypeSchema>;

// -----------------------------------------------------------------------------
// PRIMARY TRANSLATION INLINE
// Lean shape embedded in list items — just enough to render a search result
// row with Spanish meaning, audio button, and part of speech badge.
// Always the priority=1 `common` dialect translation — the form used across
// the majority of the country. Well-defined thanks to
// the (entryId, dialectCode, priority) unique constraint in schema.prisma.
// Full translation data available in DictionaryEntryDetail.
// -----------------------------------------------------------------------------

const PrimaryTranslationSchema = z.object({
  id: z.string(),
  spanishContent: z.string(),
  englishContent: z.string().nullable(),
  partOfSpeech: PartOfSpeechSchema.nullable(),
  audioUrl: z.url().nullable(),
  phonetic: z.string().nullable(),
  dialectCode: z.string(),
});

// -----------------------------------------------------------------------------
// LIST ITEM
// Used on:
//   - Public dictionary search page (/dictionary)
//   - Admin dictionary table
//   - Exercise builder (picking entries for exercises)
//   - Flashcard set builder
//
// Paginated responses use the generic envelope:
//   ApiPaginated<DictionaryEntryListItem>
// imageUrl included for IMAGE_SELECT exercise preview in admin.
// -----------------------------------------------------------------------------

export const DictionaryEntryListItemSchema = z.object({
  id: z.string(),
  type: EntryTypeSchema,
  nahuatContent: z.string(),
  imageUrl: z.url().nullable(),
  isPublished: z.boolean(),
  primaryTranslation: PrimaryTranslationSchema,
  createdAt: z.iso.datetime(),
});

export type DictionaryEntryListItem = z.infer<typeof DictionaryEntryListItemSchema>;

// -----------------------------------------------------------------------------
// DETAIL
// Used on:
//   - Public dictionary entry page (/dictionary/[entryId])
//   - Admin entry edit form
//
// All translations included, ordered by priority ascending.
// Creator name included for attribution display — id excluded (internal).
// -----------------------------------------------------------------------------

export const DictionaryEntryDetailSchema = z.object({
  id: z.string(),
  type: EntryTypeSchema,
  nahuatContent: z.string(),
  imageUrl: z.url().nullable(),
  isPublished: z.boolean(),
  creator: z.object({
    name: z.string(),
  }),
  translations: z.array(TranslationDetailSchema), // ordered by priority asc
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type DictionaryEntryDetail = z.infer<typeof DictionaryEntryDetailSchema>;

// -----------------------------------------------------------------------------
// QUERY PARAMS
// Two endpoints, two contracts (see api-reference.md):
//   GET /dictionary/entries        — structured browsing, no fuzzy search
//   GET /dictionary/entries/search — pg_trgm fuzzy search, q required
//
// isPublished uses z.stringbool() — z.coerce.boolean() would turn the query
// string "false" into true (Boolean('false') === true). REVIEWER+ only;
// service ignores it for public/USER requests.
// -----------------------------------------------------------------------------

export const DictionaryBrowseParamsSchema = PaginationParamsSchema.extend({
  type: EntryTypeSchema.optional(),
  partOfSpeech: PartOfSpeechSchema.optional(),
  dialectCode: z.string().optional(),
  isPublished: z.stringbool().optional(),
});

export const DictionarySearchParamsSchema = PaginationParamsSchema.extend({
  q: z.string().min(1), // required — endpoint 400s without it
  type: EntryTypeSchema.optional(),
  dialectCode: z.string().optional(),
});

export type DictionaryBrowseParams = z.infer<typeof DictionaryBrowseParamsSchema>;
export type DictionarySearchParams = z.infer<typeof DictionarySearchParamsSchema>;

// -----------------------------------------------------------------------------
// CREATE / UPDATE DTOs
// Translations are created separately via /translations endpoint
// (or atomically via POST /entries/full).
// imageUrl is provided after S3 upload — upload flow handled by UploadsModule.
// -----------------------------------------------------------------------------

export const CreateEntrySchema = z.object({
  nahuatContent: z.string().min(1).max(500),
  type: EntryTypeSchema.default('WORD'),
  imageUrl: z.url().optional(),
});

// PATCH — all fields optional
export const UpdateEntrySchema = CreateEntrySchema.partial();

export type CreateEntry = z.infer<typeof CreateEntrySchema>;
export type UpdateEntry = z.infer<typeof UpdateEntrySchema>;
