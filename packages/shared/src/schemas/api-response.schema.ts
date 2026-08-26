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
  field: z.string().optional(), // field path e.g. "body.nawatContent"
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
// OPTIMISTIC LOCK
//
// The `updatedAt` the client last read, sent back with the write it wants to
// perform. The service makes the update conditional on it, so a row that moved
// in between is refused (EDIT_CONFLICT) instead of overwritten.
//
// WHY THIS IS NEEDED AT ALL, since it looks like ceremony on a small project:
// the editor sends EVERY field on every save, not a diff. So a save does not
// merely overwrite what its author changed — it overwrites every field with
// whatever that author's form last loaded. Two people on one translation is
// then not a near-miss but a silent deletion: A opens a card, B adds an English
// gloss and saves, A saves an unrelated fix, and B's gloss is written back to
// null with no error anywhere.
//
// `updatedAt` rather than a version column because it already exists, already
// moves on every write (Prisma @updatedAt), and is already returned by the
// admin read shapes — so nothing needs a migration. It works as a version token
// because the columns are `timestamp(3)`: millisecond precision, exactly what an
// ISO-8601 string carries, so the round trip is lossless. A `timestamp(6)`
// column would silently truncate and never match, which is why the precision is
// stated here rather than assumed.
//
// REQUIRED, not optional. A precondition a client can omit is a precondition
// that defaults to off, which is the behaviour being fixed.
// -----------------------------------------------------------------------------

export const OptimisticLockSchema = z.iso.datetime();

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
  // A write whose precondition no longer holds: the row moved between the read
  // that populated the form and the write that submits it. Distinct from
  // CONFLICT, which covers uniqueness collisions — this one is recoverable by
  // reloading, and the client is expected to say so rather than retry blindly.
  EDIT_CONFLICT: 'EDIT_CONFLICT',
  RESTRICT_VIOLATION: 'RESTRICT_VIOLATION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Dictionary
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  ENTRY_HAS_TRANSLATIONS: 'ENTRY_HAS_TRANSLATIONS',
  ENTRY_SLUG_CONFLICT: 'ENTRY_SLUG_CONFLICT',
  TRANSLATION_NOT_FOUND: 'TRANSLATION_NOT_FOUND',
  TRANSLATION_IN_USE: 'TRANSLATION_IN_USE',
  DIALECT_NOT_FOUND: 'DIALECT_NOT_FOUND',
  DIALECT_IN_USE: 'DIALECT_IN_USE',

  // Content — Level > Course > Unit > Lesson > Exercise
  LEVEL_NOT_FOUND: 'LEVEL_NOT_FOUND',
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
  // A second Auth0 identity — a different connection, so a different `sub` —
  // presenting an email address that already belongs to a user row. Auth0 keys
  // identity on connection + subject; this API keys it on auth0Id and holds a
  // unique constraint on email, so the two cannot both exist.
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  // A verified token whose subject has no account. Since 2026-08-25 accounts
  // are created at login by POST /auth/session and nowhere else, so this means
  // the session was established without that call completing — or the row was
  // hard-deleted while the token was still valid. Distinct from UNAUTHORIZED
  // because the remedy differs: the credential is fine, the account is absent,
  // and signing in again is what fixes it.
  ACCOUNT_NOT_PROVISIONED: 'ACCOUNT_NOT_PROVISIONED',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
