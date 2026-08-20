// Prisma error codes the services branch on, and a guard to match them.
//
// These are a database-layer concern, so they live here in apps/api rather than
// in @nahuat/shared — that package is the cross-app wire contract and never
// imports Prisma. The mapping from one of these codes to an API_ERROR_CODES
// value and a message stays in each service, since it is resource-specific
// (a P2002 is CONFLICT everywhere, but the message and any P2025 → *_NOT_FOUND
// pairing differ per resource).
//
// https://www.prisma.io/docs/orm/reference/error-reference
export const PRISMA_ERROR = {
  UNIQUE_VIOLATION: 'P2002', // a unique constraint was violated
  RECORD_NOT_FOUND: 'P2025', // an operation depended on a record that does not exist
  FK_CONSTRAINT: 'P2003', // a foreign-key constraint failed (onDelete: Restrict)
} as const;

// Structural check by design, not `error instanceof
// Prisma.PrismaClientKnownRequestError`. The service unit tests mock
// @nahuat/database with `Prisma: {}`, so there is no error class to be an
// instance of, and they reject with a plain `{ code: 'P2002' }`. Matching on the
// shape survives the mock; an instanceof would not — do not "fix" this into one.
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}
