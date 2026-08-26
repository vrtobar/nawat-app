import { type Prisma } from '@nahuat/database';

// "Mine" — the entries a contributor authored, as a Prisma predicate.
//
// THIS WAS AN AUTHORIZATION BOUNDARY AND IS NOW A VIEW FILTER. The distinction
// is the whole point of the change around it, so it is recorded rather than
// left to be inferred from the absence of callers.
//
// It used to confine a CONTRIBUTOR's reads and writes to rows they created.
// That model made cross-author contribution incoherent: a contributor could add
// a dialect to another author's entry — POST /entries/:entryId/translations
// never checked ownership — and then could neither see nor edit what they had
// just written. Ownership now records WHO MADE a row, not who may change it,
// because contributors leave and their entries must stay maintainable.
//
// So nothing authorizes on this any more. It is opt-in, via ?mine=true, and the
// reads are otherwise unscoped: a contributor sees every entry, because a
// contributor may edit every entry, and a read scope narrower than the write
// scope would let someone edit a row they cannot open.
//
// AUTHORED, NOT TOUCHED — created the entry, or created one of its
// translations. Deliberately NOT "entries I have edited": `updaterId` records
// the LAST writer, not every writer, so an updater-based filter would show a
// caller their own work and then silently drop it the moment anyone else saved
// that row. A view that loses your work because a colleague fixed a typo is
// worse than one that answers a narrower question. The broader "everything I
// have touched" needs the audit trail, which does not exist yet.
//
// Unindexed on purpose: neither creator_id column carries an index, and this
// adds a relation semi-join across both. At the current volume an index chosen
// before there is a query plan worth reading would be a guess.
export function authoredBy(userId: string): Prisma.EntryWhereInput {
  return {
    OR: [{ creatorId: userId }, { translations: { some: { creatorId: userId, deletedAt: null } } }],
  };
}
