# 16. Dictionary entry slugs

- **Status:** Accepted
- **Date:** 2026-08-21
- **Applies to:** `packages/database/prisma/schema.prisma`,
  `packages/shared/src/slugify.ts`, `apps/api/src/modules/dictionary/`
- **Depends on:** [ADR 14](0014-nawat-for-the-language-nahuat-for-the-project.md)
  for the spelling of the Nawat-bearing field, [ADR 15](0015-localized-content.md)
  for how the by-slug read resolves a locale, [ADR 8](0008-rest-resource-shape.md)
  for the route shape

## Context

The public dictionary needs a way to address an entry in a URL. `Entry.id` is a
cuid — stable and unique, but opaque: `/dictionary/cmt1msohc0006hr8c2hhj04ov`
tells a reader and a search engine nothing. For a dictionary the headword _is_
the thing a person looks up, so the word itself is the natural identifier, and
for a critically endangered language with roughly a hundred speakers,
discoverability is not a nicety — being findable is part of preservation.

This record is written now, with the content tables empty, because a URL
structure is a contract: once entries are indexed and linked, changing how they
are addressed breaks every inbound reference. The decision costs a column today
and a migration against real content later.

## Decision

### 1. The slug is the canonical public identifier — stored, unique, looked up directly

`Entry` gains a `slug` column, `@unique`, and the public dictionary addresses
entries by it: `GET /entries/by-slug/:slug` serves the detail page behind
`/dictionary/[slug]`. The slug is _stored_, not derived on read, so the database
owns its uniqueness; and it is the _lookup key_, not a cosmetic suffix on an
id-based URL.

The hybrid `/dictionary/[id]/[slug]` shape — a human slug for SEO, the stable id
for lookup, as Stack Overflow does — was the safe default and is rejected below.
It removes the two risks this decision has to face (collisions and renames) by
never trusting the slug, but it keeps the opaque cuid in the URL, and the whole
point is a URL made of the word. With content still empty, the durable structure
costs the same to adopt as the timid one.

### 2. Accent-folding is safe for Nawat — and would not be for Spanish

`slugifyNawat` folds accents (`nè` → `ne`), lowercases, hyphenates whitespace
(`ken tinemi` → `ken-tinemi`), and drops apostrophes and other non-alphanumerics
(`ne'` → `ne`).

Folding accents out of a canonical identifier is the interesting call, because
in a Spanish dictionary it would be wrong. Spanish accents are _lexically
distinctive_: `papa` (potato) and `papá` (dad), `si` (if) and `sí` (yes) are
different words. A Spanish dictionary therefore keeps the accent in the
canonical headword and makes only _search_ accent-insensitive — you type `papa`
and find both, but each has its own page.

Nawat is the opposite. Its accents are non-distinctive — a pedagogical stress
mark, not a contrast that changes a word — so no two entries differ by accent
alone, and folding cannot merge two genuinely different headwords. The codebase
already leans on exactly this: entry search matches on
`immutable_unaccent(nawat_content)` (see [ADR 15](0015-localized-content.md)),
treating `ne` and `nè` as one word. Folding the slug is the same premise applied
to identity rather than search.

### 3. The unique constraint turns a fold-collision into a loud failure

"No two entries differ by accent alone" is a claim about the language, not a
guarantee the database enforces — and `né` meaning "over there" versus `ne`
meaning "he/she/they" shows the rare homonym does exist. So the slug column is
`@unique`, and that is the load-bearing safety net: if two distinct headwords
ever fold to the same slug, the second write fails on the constraint rather than
silently overwriting the first entry's address.

The service reads which constraint a `P2002` violated and maps a slug clash to
`ENTRY_SLUG_CONFLICT`, distinct from the `CONFLICT` a duplicate `nawatContent`
raises. The distinction is the point: an admin seeing "another entry already
uses this slug" knows to disambiguate, where a false "that word already exists"
would mislead. A fold-collision is thus a loud, actionable error at
content-entry time — which, being admin-only and pre-launch, is a good place for
one — not a silent corruption discovered when a link goes to the wrong word.

### 4. Generated in application code, not a database `GENERATED` column

A Postgres `GENERATED ALWAYS AS (…) STORED` column would make the slug
impossible to drift from `nawatContent` and would recompute on every rename for
free. It is rejected for two reasons. Prisma models generated columns poorly —
it would try to write the column on insert, which `GENERATED ALWAYS` forbids —
and a fully-generated slug can never be overridden, foreclosing the manual
disambiguation the editorial-review module will want the first time two
headwords legitimately collide. So `slugifyNawat` lives in `@nahuat/shared` and
is called by the entry writes and by the seed, one function shared by every
producer.

### 5. The migration adds the column `NOT NULL` with no backfill

Every entry must be addressable, so `slug` is `NOT NULL`. Adding a required
column with no default is only valid on an empty table — which is the case
everywhere this migration runs. Locally the dev database is reset and reseeded
(the seed generates slugs); in production the dictionary is pre-launch and its
tables are created empty by this same migration series, with content entered
later through the admin, which generates the slug in app code. The migration
header records this assumption, because a backfill would be required the day it
stopped holding. Writing a backfill now would also mean a second slugify
implementation in SQL, drifting from the TypeScript one — the exact duplication
[ADR 10](0010-zod-as-the-payload-contract.md) warns against.

### 6. Lookup and locale

`GET /entries/by-slug/:slug` shares its select and its published-only visibility
with `GET /entries/:id`, so the two paths to the same page return an identical
shape and resolve a locale identically (`?locale=` → token → `Accept-Language` →
`es`, per [ADR 15](0015-localized-content.md)). A missing, unpublished, or
soft-deleted slug is reported as not-found, exactly as an unknown id is.

## Consequences

- **`slug` joins the list and detail response schemas** and every read/write
  select. The web dictionary builds `/dictionary/[slug]` links from browse and
  search results, and the detail page fetches by slug.
- **A rename breaks the old URL.** Correcting a headword's spelling regenerates
  its slug, and the previous slug 404s. This is deferred deliberately: a
  slug-history / redirect table belongs with the **editorial-review module**,
  which already owns the problem of edits to published content. It costs nothing
  until entries have inbound links, which is post-launch.
- **The `P2002` column check is coupled to the pg driver adapter's error shape.**
  Prisma's documented `meta.target` is `undefined` under the adapter (verified
  against 7.9); the violated columns live at
  `meta.driverAdapterError.cause.constraint.fields`. `uniqueViolationFields`
  reads that one shape and returns `[]` on anything else, so a future Prisma
  version that moves it degrades a slug clash to the generic conflict rather than
  throwing — a wrong message, not a crash.
- **`PHRASE` entries have slugs too**, though the public dictionary never
  surfaces them: browse and search exclude `PHRASE`, so the UI hands out no
  lesson-phrase slug, and `by-slug` mirrors `by-id` in not filtering type — a
  direct request for a known phrase slug resolves, which is harmless since lesson
  text is not secret.
- **A third-party importing the dictionary gets stable, word-shaped URLs** for
  free, which is the SEO payoff the decision exists for.

## Alternatives considered

**cuid-only URLs (`/dictionary/<cuid>`).** No new column, no collisions, no
rename risk. Rejected because the identifier is opaque: it carries no relevance
signal for search and nothing a person can read, share, or guess, which for a
preservation project is the cost that matters.

**Hybrid `/dictionary/[id]/[slug]`, lookup by id.** The slug is cosmetic; the
cuid is authoritative, so collisions and renames simply cannot break a link
(the slug can be anything). Rejected because it keeps the opaque cuid in the
URL, and because the risks it removes are cheap to handle directly — a
`@unique` column for collisions, and a deferred redirect table for renames —
without paying the ugliness.

**A Postgres `GENERATED` column.** Zero drift, free regeneration. Rejected on
Prisma's poor support for generated columns and because it forecloses the manual
slug override editorial review will need. Covered in §4.

**Bare slug now, with a slug-history redirect table.** The complete version of
this decision. Rejected only on timing: there are no inbound links to preserve
until launch, and the redirect table is the editorial-review module's to build,
alongside the review of published edits it is coupled to.

**Preserve accents in the slug, percent-encoded, like Spanish dictionaries.**
Lossless, collision-free by construction. Rejected because it solves a problem
Nawat does not have — its accents are non-distinctive (§2) — at the cost of URLs
like `/dictionary/n%C3%A8`, trading the readable identifier this decision exists
to produce for safety against a collision the `@unique` column already catches.
