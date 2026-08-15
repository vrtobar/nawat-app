-- Partial indexes for the public "live content" read paths.
--
-- Entirely hand-written: Prisma cannot express a WHERE clause on an index, so
-- none of these can live in schema.prisma. Verified that Prisma's differ leaves
-- them alone — a subsequent `migrate dev` after an unrelated schema change
-- emits only that change and never a DROP INDEX for these.
--
-- WHAT THEY REPLACE. The schema previously carried, on each content table, a
-- single-column index on deletedAt (and archivedAt) plus a composite on
-- (isPublished, deletedAt). The single-column ones were near-useless: almost
-- every row has deletedAt IS NULL, so that predicate matches ~100% of the table
-- and the planner picks a sequential scan regardless. Moving the predicate into
-- a partial index inverts that — the index contains only live rows, so it stays
-- small, and the leading columns are the ones actually filtered and sorted on.
--
-- WHY THE ADMIN INDEXES STAY. Each table keeps its unfiltered (parent, order)
-- btree. The admin panel browses drafts and archived rows, which these partial
-- indexes deliberately exclude.
--
-- MAINTENANCE. A partial index is only usable when the query's WHERE clause
-- implies the index predicate. If the application's published/soft-delete
-- filter ever changes shape, these stop being used silently — no error, just a
-- sequential scan. Confirm with EXPLAIN when the query layer is written.

-- Public dictionary list: published, not deleted, alphabetical by headword.
-- Also serves prefix search (nahuat_content LIKE 'foo%') over live entries;
-- leading-wildcard search goes to entries_nahuat_content_trgm_idx instead.
CREATE INDEX "entries_live_idx" ON "entries" ("nahuat_content")
  WHERE "is_published" AND "deleted_at" IS NULL;

-- Translations for an entry, in display order. priority is the tiebreak that
-- makes "the priority=1 translation" a single well-defined row.
CREATE INDEX "translations_live_idx" ON "translations" ("entry_id", "priority")
  WHERE "is_published" AND "deleted_at" IS NULL;

-- Course browser within a level.
CREATE INDEX "courses_live_idx" ON "courses" ("level_id", "order")
  WHERE "is_published" AND "deleted_at" IS NULL AND "archived_at" IS NULL;

-- Units within a course.
CREATE INDEX "units_live_idx" ON "units" ("course_id", "order")
  WHERE "is_published" AND "deleted_at" IS NULL AND "archived_at" IS NULL;

-- Lessons within a unit.
CREATE INDEX "lessons_live_idx" ON "lessons" ("unit_id", "order")
  WHERE "is_published" AND "deleted_at" IS NULL AND "archived_at" IS NULL;
