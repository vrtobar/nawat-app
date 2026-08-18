import { z } from 'zod';

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
});

export const UpdateDialectSchema = CreateDialectSchema.partial();

export type Dialect = z.infer<typeof DialectSchema>;
export type CreateDialect = z.infer<typeof CreateDialectSchema>;
export type UpdateDialect = z.infer<typeof UpdateDialectSchema>;
