import { z } from 'zod';

// =============================================================================
// UNIFORM API RESPONSE ENVELOPE
// Applied to all NestJS endpoints via a global interceptor.
//
// correlationId policy:
//   X-Correlation-ID header — present on ALL responses, success and error
//   Response body           — correlationId only on ERROR responses.
// =============================================================================

// -----------------------------------------------------------------------------
// PAGINATION
// PaginationParamsSchema — shared query params, extended by list endpoints.
// PaginationMetaSchema   — returned alongside data on all paginated lists.
// totalPages derived from total / limit — computed in NestJS service.
// -----------------------------------------------------------------------------

export const PaginationParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const PaginationMetaSchema = z.object({
  total: z.number().int(), // total matching records
  page: z.number().int(), // current page (1-indexed)
  limit: z.number().int(), // records per page
  totalPages: z.number().int(), // Math.ceil(total / limit)
});

export type PaginationParams = z.infer<typeof PaginationParamsSchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

// -----------------------------------------------------------------------------
// SUCCESS RESPONSES
// -----------------------------------------------------------------------------

// Single item or action result
export const ApiSuccessSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

// Paginated list
export const ApiPaginatedSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    success: z.literal(true),
    data: z.array(itemSchema),
    meta: PaginationMetaSchema,
  });

// -----------------------------------------------------------------------------
// ERROR RESPONSE
// code          — machine-readable, used by frontend to handle specific errors
// message       — human-readable, safe to display to the user
// correlationId — support-reportable request ID (also in X-Correlation-ID header)
// details       — optional field-level validation errors from ZodValidationPipe
// -----------------------------------------------------------------------------

export const ApiErrorDetailSchema = z.object({
  field: z.string().optional(), // field path e.g. "body.nahuatContent"
  message: z.string(),
});

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    details: z.array(ApiErrorDetailSchema).optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

// -----------------------------------------------------------------------------
// HELPER TYPES
// Typed wrappers for use in NestJS service return types and Next.js fetch utils.
// -----------------------------------------------------------------------------

export type ApiSuccess<T> = { success: true; data: T };
export type ApiPaginated<T> = { success: true; data: T[]; meta: PaginationMeta };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// -----------------------------------------------------------------------------
// ERROR CODE CONSTANTS
// -----------------------------------------------------------------------------

export const API_ERROR_CODES = {
  // Generic
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RESTRICT_VIOLATION: 'RESTRICT_VIOLATION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Dictionary
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  ENTRY_HAS_TRANSLATIONS: 'ENTRY_HAS_TRANSLATIONS',
  TRANSLATION_NOT_FOUND: 'TRANSLATION_NOT_FOUND',
  TRANSLATION_IN_USE: 'TRANSLATION_IN_USE',
  DIALECT_NOT_FOUND: 'DIALECT_NOT_FOUND',
  DIALECT_IN_USE: 'DIALECT_IN_USE',

  // Lessons
  COURSE_NOT_FOUND: 'COURSE_NOT_FOUND',
  COURSE_NOT_PUBLISHABLE: 'COURSE_NOT_PUBLISHABLE',
  UNIT_NOT_FOUND: 'UNIT_NOT_FOUND',
  UNIT_NOT_PUBLISHABLE: 'UNIT_NOT_PUBLISHABLE',
  LESSON_NOT_FOUND: 'LESSON_NOT_FOUND',
  LESSON_LOCKED: 'LESSON_LOCKED',
  LESSON_NOT_PUBLISHABLE: 'LESSON_NOT_PUBLISHABLE',
  EXERCISE_NOT_FOUND: 'EXERCISE_NOT_FOUND',
  EXERCISE_INVALID_CONFIG: 'EXERCISE_INVALID_CONFIG',
  EXERCISE_INVALID_ROLES: 'EXERCISE_INVALID_ROLES',
  EXERCISE_MISSING_AUDIO: 'EXERCISE_MISSING_AUDIO',
  EXERCISE_MISSING_IMAGE: 'EXERCISE_MISSING_IMAGE',

  // Flashcards
  FLASHCARD_SET_NOT_FOUND: 'FLASHCARD_SET_NOT_FOUND',
  FLASHCARD_ALREADY_IN_SET: 'FLASHCARD_ALREADY_IN_SET',

  // Auth / users
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
