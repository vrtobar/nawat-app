import { z } from 'zod';

// The dialect code a request falls back to when it pins none: the form in broad
// use rather than any one town's. A preference, not a guarantee — an entry may
// have no `common` translation (a word attested only regionally), which the
// read services handle by falling back to its lowest-priority form. Defined
// here, in the contract package, so the seed that CREATES this row and the API
// that RESOLVES against it share one literal and cannot drift; the web dialect
// filter reads it as its default selection too. Parallels DEFAULT_LOCALE.
export const DEFAULT_DIALECT_CODE = 'common';

// -----------------------------------------------------------------------------
// DIALECT
// No list/detail split needed — dialect is a simple reference entity.
// Used in translation forms, dictionary filters, and translation responses.
// -----------------------------------------------------------------------------

export const DialectSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  descriptionEs: z.string(),
  descriptionEn: z.string(),
  // Display order across dialects: lower comes first. `common` is 0, so the
  // broadly-used form leads; towns follow in a chosen order. This is the single
  // ordering for an entry's translations and the basis of its headword pick,
  // now that a dialect has at most one translation per entry.
  precedence: z.number().int(),
});

export const CreateDialectSchema = z.object({
  code: z.string().min(1).max(32),
  // Required in both languages, unlike every other localized model — dialects
  // are reference data the project authors, so there is no contributor to
  // unblock by making English optional.
  nameEs: z.string().min(1).max(100),
  nameEn: z.string().min(1).max(100),
  descriptionEs: z.string().min(1),
  descriptionEn: z.string().min(1),
  // Optional — omitted, a new dialect defaults to sorting last (schema default
  // 100) until an admin places it. Not unique; ties break on code.
  precedence: z.number().int().optional(),
});

export const UpdateDialectSchema = CreateDialectSchema.partial();

export type Dialect = z.infer<typeof DialectSchema>;
export type CreateDialect = z.infer<typeof CreateDialectSchema>;
export type UpdateDialect = z.infer<typeof UpdateDialectSchema>;
