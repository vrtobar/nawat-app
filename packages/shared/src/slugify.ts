// Deterministic URL slug for a dictionary Entry, derived from its nawatContent.
// The dictionary addresses entries by slug (GET /entries/by-slug/:slug), so this
// is the canonical public identifier — see docs/adr/0016-dictionary-entry-slugs.
//
// Folding accents is SAFE for Nawat because accents there are non-distinctive (a
// pedagogical stress mark, not a lexical contrast as in Spanish papa/papá), so
// two entries never differ by accent alone. The stored slug is @unique, so the
// rare case where two distinct headwords fold to the same slug fails loudly at
// write time (ENTRY_SLUG_CONFLICT) rather than silently colliding.
//
// Multi-word EXPRESSION entries hyphenate ("ken tinemi" -> "ken-tinemi");
// apostrophes and any other non-alphanumerics are dropped ("ne'" -> "ne").
export function slugifyNawat(nawatContent: string): string {
  return nawatContent
    .normalize('NFKD') // split accented letters into base char + combining mark
    .replace(/[̀-ͯ]/g, '') // drop the combining marks: à -> a
    .toLowerCase()
    .replace(/[\s_]+/g, '-') // whitespace and underscores become hyphens
    .replace(/[^a-z0-9-]/g, '') // drop everything else, apostrophes included
    .replace(/-+/g, '-') // collapse runs of hyphens
    .replace(/^-+|-+$/g, ''); // trim leading and trailing hyphens
}
