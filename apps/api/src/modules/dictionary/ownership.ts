import { type Prisma } from '@nahuat/database';
import { type JwtClaims } from '@nahuat/shared';

// Who a caller is allowed to touch, as a Prisma predicate.
//
// Extracted rather than repeated because it is an authorization rule and there
// are now three sites applying it — the admin read surface, the entry update and
// the translation update. Three copies of a rule like this is how one of them
// quietly stops matching the others.
//
// NEGATED AGAINST ADMIN rather than matched against CONTRIBUTOR: if a rank is
// ever added between them, an unrecognised role is scoped to its own rows
// instead of silently seeing everything.
//
// Applied inside the WHERE, never as a check after the read. That is what makes
// a cross-author row indistinguishable from a missing one — both come back as
// nothing and raise the same 404 — so no endpoint here can be used to test
// whether an id exists.
export function entryOwnership(role: JwtClaims['role'], userId: string): Prisma.EntryWhereInput {
  return role === 'ADMIN' ? {} : { creatorId: userId };
}

// The same rule reached through a translation's parent entry.
//
// Scoped by the ENTRY's creator, not the translation's, so that what a
// CONTRIBUTOR may write matches exactly what the admin read surface shows them
// — GET /admin/entries scopes on entry.creatorId, and a writable row they
// cannot see would be the stranger arrangement.
//
// Consequence worth naming: POST /entries/:entryId/translations has no
// ownership check, so a contributor CAN add a dialect to another author's entry
// and then not be able to edit it. That asymmetry predates this and is left
// alone deliberately — whether cross-author contribution should be allowed at
// all is a product question, and answering it by quietly tightening one write
// path would settle it by accident.
export function translationOwnership(
  role: JwtClaims['role'],
  userId: string,
): Prisma.TranslationWhereInput {
  return role === 'ADMIN' ? {} : { entry: { creatorId: userId } };
}
