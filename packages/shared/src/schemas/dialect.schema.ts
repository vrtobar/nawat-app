import { z } from 'zod';

// -----------------------------------------------------------------------------
// DIALECT
// No list/detail split needed — dialect is a simple reference entity.
// Used in translation forms, dictionary filters, and translation responses.
// -----------------------------------------------------------------------------

export const DialectSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});

export const CreateDialectSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

export const UpdateDialectSchema = CreateDialectSchema.partial();

export type Dialect = z.infer<typeof DialectSchema>;
export type CreateDialect = z.infer<typeof CreateDialectSchema>;
export type UpdateDialect = z.infer<typeof UpdateDialectSchema>;
