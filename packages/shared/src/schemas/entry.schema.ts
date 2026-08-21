import { z } from 'zod';

import { PaginationParamsSchema } from './api-response.schema';
import { LocaleSchema } from './locale.schema';
import {
  CreateTranslationSchema,
  PartOfSpeechSchema,
  TranslationDetailSchema,
} from './translation.schema';

// -----------------------------------------------------------------------------
// ENUMS
// -----------------------------------------------------------------------------

// WORD and EXPRESSION are dictionary headwords — a single word vs. a multi-word
// lexical unit (idiom, fixed/common expression, collocation). PHRASE is a full
// teaching utterance that lives in lessons, not the dictionary browse; the
// public dictionary reads restrict to WORD/EXPRESSION.
export const EntryTypeSchema = z.enum(['WORD', 'EXPRESSION', 'PHRASE']);
export type EntryType = z.infer<typeof EntryTypeSchema>;

// -----------------------------------------------------------------------------
// PRIMARY TRANSLATION INLINE
// Lean shape embedded in list items — just enough to render a dictionary row
// with its meaning, audio button, and part of speech badge. Full translation
// data available in DictionaryEntryDetail.
//
// Which translation this is depends on the request. Default browse shows the
// whole dictionary and picks a representative form per entry: the one whose
// dialect has the lowest precedence (Dialect.precedence — `common` is 0, so the
// broadly-used form wins when present), otherwise the highest-precedence dialect
// the entry does have — so a word attested only in, say, Izalco still appears,
// labelled with its dialect rather than hidden for lacking a common form. A
// `?dialectCode=` filter narrows to that dialect. `dialectCode` on this shape
// names which it turned out to be. A dialect has at most one translation per
// entry, so there is no within-dialect tiebreak; precedence is the whole order.
//
// `content` is resolved to one locale server-side (ADR 0015 §4), never both
// languages — see TranslationDetailSchema for the reasoning. Non-null because
// entries with no renderable translation in the resolved locale are filtered
// out of the list — only reachable for English, since Spanish content is
// mandatory on every translation. `locale` echoes which language was served.
// -----------------------------------------------------------------------------

const PrimaryTranslationSchema = z.object({
  id: z.string(),
  content: z.string(),
  locale: LocaleSchema,
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
  nawatContent: z.string(),
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
// All translations included, ordered by dialect precedence ascending.
// Creator name included for attribution display — id excluded (internal).
// -----------------------------------------------------------------------------

export const DictionaryEntryDetailSchema = z.object({
  id: z.string(),
  type: EntryTypeSchema,
  nawatContent: z.string(),
  imageUrl: z.url().nullable(),
  isPublished: z.boolean(),
  creator: z.object({
    name: z.string(),
  }),
  translations: z.array(TranslationDetailSchema), // ordered by dialect precedence asc
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type DictionaryEntryDetail = z.infer<typeof DictionaryEntryDetailSchema>;

// -----------------------------------------------------------------------------
// QUERY PARAMS
// Two endpoints, two contracts (see api-reference.md). Routes are flat — no
// module prefix (ADR 0008):
//   GET /entries        — structured browsing, no fuzzy search
//   GET /entries/search — pg_trgm fuzzy search, q required
//
// isPublished uses z.stringbool() — z.coerce.boolean() would turn the query
// string "false" into true (Boolean('false') === true). CONTRIBUTOR+ only;
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
  nawatContent: z.string().min(1).max(500),
  type: EntryTypeSchema.default('WORD'),
  imageUrl: z.url().optional(),
});

// PATCH — all fields optional
export const UpdateEntrySchema = CreateEntrySchema.partial();

// POST /entries/full — an entry and its first translations in one atomic
// request. At least one translation: a full create with none is just POST
// /entries, and this path exists precisely to seed an entry with content in a
// single call. Each translation is a distinct dialect (one per dialect per
// entry); two sharing a dialectCode collide on the unique constraint.
export const CreateFullEntrySchema = CreateEntrySchema.extend({
  translations: z.array(CreateTranslationSchema).min(1),
});

export type CreateEntry = z.infer<typeof CreateEntrySchema>;
export type UpdateEntry = z.infer<typeof UpdateEntrySchema>;
export type CreateFullEntry = z.infer<typeof CreateFullEntrySchema>;
