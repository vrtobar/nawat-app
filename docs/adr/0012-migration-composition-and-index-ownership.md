# 12. Migration composition and index ownership

- **Status:** Accepted
- **Date:** 2026-08-16 (records a decision taken 2026-08-15)
- **Applies to:** `packages/database/prisma/`
- **Complements:** [ADR 7](0007-database-connectivity-and-migrations.md), which
  records how migrations _run_. This one records how they are _composed_.

## Context

`packages/database/prisma/migrations/` did not exist until 2026-08-15. The
schema had been maintained as `schema.prisma` alone and never materialised into
SQL, so the first migration was also the moment the schema's contents became
permanent — a wrong index committed there would need a `DROP INDEX` migration
to remove, rather than an edit.

Three things had to be created that Prisma does not treat alike:

1. **Ordinary tables, enums, foreign keys and indexes.** Prisma generates these
   from `schema.prisma`.
2. **Trigram GIN indexes** for substring search. A btree cannot serve a leading
   wildcard (`ILIKE '%foo%'`); a GIN index over `gin_trgm_ops` can.
3. **The `pg_trgm` extension** those indexes require.

Prisma's ability to express each of them differs, and that difference — not
taste — is what the arrangement below follows from.

## Decision

**Each object is owned by the highest-level tool that can express it, and the
migration set is split along that line.**

| Migration                             | Author       | Contents                              |
| ------------------------------------- | ------------ | ------------------------------------- |
| `20260815155000_enable_pg_trgm`       | hand-written | `CREATE EXTENSION IF NOT EXISTS`      |
| `20260815155316_init`                 | Prisma       | tables, enums, keys, ordinary indexes |
| `20260815160500_partial_live_indexes` | hand-written | the five `*_live_idx` partial indexes |

So index ownership is three-way:

- **Prisma owns the three trigram indexes**, because it can express them —
  `@@index([nahuatContent(ops: raw("gin_trgm_ops"))], type: Gin, map: "…")`.
  They are declared in `schema.prisma` and appear in the generated `init`
  migration like any other index.
- **Raw SQL owns the five partial indexes**, because Prisma cannot express an
  index `WHERE` clause at all. There is no way to declare
  `WHERE is_published AND deleted_at IS NULL` in `schema.prisma`.
- **Neither owns the extension.** Prisma does not model extensions without the
  `postgresqlExtensions` preview feature, so it neither creates nor drops them.

### Why the extension gets its own migration

Two reasons, and the first is the one that matters.

**Regenerating `init` rewrites the whole file.** Prisma only ever rewrites the
migration it is told to generate, so a hand-added `CREATE EXTENSION` kept inside
`init` is destroyed the next time anyone runs
`prisma migrate dev --create-only --name init`. Nothing reports it. The loss
surfaces later and somewhere else — on a fresh database, when the
`gin_trgm_ops` indexes in that same file fail because the operator class does
not exist. An isolated file cannot be caught by that, because nobody
regenerates it.

**It can be applied out of band.** If an environment ever refuses extension
creation to the migrating role, one file can be run manually and marked with
`prisma migrate resolve --applied`. A statement embedded in `init` offers no
such seam. (`pg_trgm` is a trusted extension as of PostgreSQL 13, so the RDS
master user installs it without `rds_superuser`, and this has not been needed.)

**Ordering is load-bearing.** `enable_pg_trgm` sorts before `init` because the
`gin_trgm_ops` indexes error if the extension does not already exist. This also
means the sequence cannot be introduced retroactively: Prisma replays applied
history in recorded order, so a database that has already applied `init` cannot
adopt an earlier migration and must be reset. Nothing had applied anything when
this landed, so the cost was bounded to a local development database mid-branch.

### The index cleanup done in the same commit

Committing the first migration freezes whatever indexes exist, so the schema was
audited against `pg_index` first. **Twenty-eight `@@index` declarations were
removed, in two distinct groups that are easy to conflate.**

**Fourteen were redundant** — no query could ever prefer them, because each was
shadowed by another index with the same leading columns:

- two were exact duplicates of a `@unique` constraint
  (`entries_nahuat_content_idx`, `users_username_idx`)
- six were single-column indexes covered by a composite — every
  `@@index([isPublished])` sat behind `@@index([isPublished, deletedAt])`, and
  `@@index([userId])` on `FlashcardSet` sat behind `[userId, updatedAt]`
- six were single-column indexes covered by the leading column of a `@@unique`
  — `Translation.entryId`, `Flashcard.setId`,
  `ExerciseTranslation.exerciseId`, and `userId` on all three
  `User*Progress` tables

Index count on the content tables went 87 → 64. Doing this before the first
migration was committed meant no `DROP INDEX` was ever needed.

**The other fourteen were replaced rather than kept.** These were the
single-column `deletedAt` / `archivedAt` indexes and the
`(isPublished, deletedAt)` composites. The single-column ones were near-useless
for a reason worth stating precisely: almost every row has `deletedAt IS NULL`,
so the predicate matches ~100% of the table and the planner picks a sequential
scan regardless of the index. An index is only worth reading when it eliminates
most of the table.

Moving the predicate into a partial index inverts that. `entries_live_idx`
contains only live rows, so it stays small, and its columns are the ones
actually filtered and sorted on:

```sql
CREATE INDEX "entries_live_idx" ON "entries" ("nahuat_content")
  WHERE "is_published" AND "deleted_at" IS NULL;
```

Each content table keeps its unfiltered `(parent, order)` btree, because the
admin panel browses drafts and archived rows that these partial indexes
deliberately exclude.

### What was verified rather than assumed

- **Prisma's differ leaves the partial indexes alone.** A `migrate dev` after an
  unrelated schema change emits only that change and never a `DROP INDEX` for
  them.
- **The planner uses them unforced**, against 50k local rows: `entries_live_idx`
  for the dictionary list, `entries_nahuat_content_trgm_idx` for
  `ILIKE '%term%'`.
- **`migrate deploy` against an empty database** — the path the one-off ECS task
  takes ([ADR 7](0007-database-connectivity-and-migrations.md)) — produces an
  identical schema and is a no-op on re-run.

## Consequences

- **`schema.prisma` is no longer the full index set, and cannot be read as
  one.** Five indexes exist only in migration SQL. Pointer comments were added
  to each affected model so the file does not read as complete, but a comment is
  not a check: adding `@@index([isPublished, deletedAt])` to `Entry` would
  duplicate `entries_live_idx` and nothing would object.
- **Regenerating `init` is safe; deleting `enable_pg_trgm` is not.** That
  asymmetry is the single most important thing to carry forward, and it is the
  reason the extension is not simply a line in the big file.
- **A partial index is only usable when the query's `WHERE` clause implies the
  index predicate.** If the published / soft-delete filter changes shape — the
  application starts querying `deleted_at IS NULL` without `is_published`, say —
  these stop being used **silently**. No error, just a sequential scan. Worth
  re-confirming with `EXPLAIN` when the dictionary and course-browser queries
  are actually written.
- **The two cleanups interact, and left a real gap.** The six
  `@@index([isPublished])` declarations were removed because
  `(isPublished, deletedAt)` shadowed them — and then those composites were
  themselves replaced by partial indexes that exclude unpublished rows. So the
  admin "drafts" view, `WHERE is_published = false`, now has no supporting index
  and will sequential-scan. This is fine at zero content and arguably fine
  permanently, since the admin panel is low-volume and authenticated, but it is
  a deliberate gap rather than an oversight. The fix, if it becomes measurable,
  is a small partial index per table on the inverse predicate.
- **`users.deletedAt` lost its index with nothing replacing it.** There is no
  `users_live_idx` — the five partial indexes cover content tables only. Soft
  deletion on `users` is currently rare enough that this has no query behind it,
  which is exactly why it should be noticed before one is written.
- **The trigram indexes index an empty table.** Nothing has created an `Entry`
  yet. They were built for the dictionary module, not for current traffic.
- **`@@index([spanishContent])` and `@@index([englishContent])` survive
  alongside the GIN indexes.** They are not redundant — btree serves equality,
  prefix and `ORDER BY`, which GIN does not — but no query needs them yet, so
  they may be dead weight. Kept because dropping a btree later is cheap and
  guessing wrong now is not.
- **Consumers outside Prisma depend on constraints they cannot see.** Once
  `audit-consumer` is Python ([ADR 11](0011-polyglot-workers-and-packaging.md)),
  its idempotency rests on `AuditLog.sqsMessageId @unique` — declared in
  `schema.prisma`, created by a Prisma migration, and invisible from the code
  that relies on it. This record's ownership split is what makes that traceable
  at all.

## Alternatives considered

**Put `CREATE EXTENSION` inside the `init` migration.** One fewer file, and
correct on the day it is written. Rejected because it is destroyed silently by
the ordinary act of regenerating `init`, and the failure appears later, on a
different machine, as a confusing error about an operator class.

**Enable the `postgresqlExtensions` preview feature** so Prisma models the
extension in `schema.prisma` and owns it like everything else. This is the
alternative most likely to supersede this record, and it should be revisited if
the feature reaches general availability. Rejected for now because preview
features change shape between Prisma releases, and this particular statement has
to be correct at deploy time against a live database — a poor place to depend on
an unstable API for the sake of removing one 25-line file.

**Move the trigram indexes into raw SQL too, for consistency.** Superficially
tidier: all hand-written indexes in one place, `schema.prisma` holding only what
Prisma generates. Rejected because it makes `schema.prisma` show even less of
the truth. Prisma _can_ express these, so letting it do so keeps three of the
eight non-trivial indexes visible in the schema and maintained across
regenerations. The rule is ownership by expressiveness, and consistency in the
other direction would cost information.

**Keep the `(isPublished, deletedAt)` composites alongside the new partial
indexes.** Safer-feeling, and cheap to leave in place. Rejected because they are
strictly dominated for the live-content queries and were near-useless for
anything else, and because the moment to remove an index for free is before the
first migration exists.

**Skip migrations entirely and use `prisma db push`.** Rejected upstream of this
record — [ADR 7](0007-database-connectivity-and-migrations.md) commits to
migrations run as a one-off ECS task, which needs a reviewable, ordered,
replayable set of files.
