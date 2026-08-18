-- Rename half of the localized-content work: every field that changes name,
-- and nothing that changes shape. The English columns, User.locale and the
-- nullability changes land in the migration after this one.
--
-- ENTIRELY HAND-WRITTEN. `prisma migrate dev` generates DROP COLUMN + ADD
-- COLUMN for all fourteen renames, which discards the data in them. That is
-- harmless today — the content tables hold only seeded placeholder rows — and
-- it is still wrong: this file is the pattern the next rename copies, and by
-- then there will be real Nawat in these columns.
--
-- Two renames are ADR 14 (Nawat names the language, Nahuat names the project);
-- the rest are ADR 15's <field><Locale> suffix, which is what makes locale
-- resolution a template-literal index rather than a per-field mapping.

-- Direction: a value rename, not a value drop.
--
-- PostgreSQL has no ALTER TYPE ... DROP VALUE — that is why dropping REVIEWER
-- in 20260817211522 needed a six-statement type swap, and Prisma's generated
-- diff proposes that same swap here because it only ever sees "these two
-- labels left, these two arrived". RENAME VALUE has existed since PG 10 and
-- rewrites nothing: it edits pg_enum in place, and exercises.direction's
-- default follows automatically because a default stores the enum by OID
-- rather than by label.
--
-- Deliberately not expanded for English. NAWAT_TO_EN / EN_TO_NAWAT belong to
-- exercise generation, which ADR 15 defers — a multiple-choice question with
-- Spanish distractors is a different exercise from its English counterpart,
-- not a translation of one.
ALTER TYPE "Direction" RENAME VALUE 'NAHUAT_TO_SPANISH' TO 'NAWAT_TO_SPANISH';
ALTER TYPE "Direction" RENAME VALUE 'SPANISH_TO_NAHUAT' TO 'SPANISH_TO_NAWAT';

-- ADR 14 — these name the language.
ALTER TABLE "entries" RENAME COLUMN "nahuat_content" TO "nawat_content";
ALTER TABLE "translations" RENAME COLUMN "example_nahuat" TO "example_nawat";

-- ADR 15 — <field><Locale>.
ALTER TABLE "translations" RENAME COLUMN "spanish_content" TO "content_es";
ALTER TABLE "translations" RENAME COLUMN "english_content" TO "content_en";
ALTER TABLE "translations" RENAME COLUMN "example_spanish" TO "example_es";

ALTER TABLE "dialects" RENAME COLUMN "name" TO "name_es";
ALTER TABLE "dialects" RENAME COLUMN "description" TO "description_es";

ALTER TABLE "levels" RENAME COLUMN "title" TO "title_es";
ALTER TABLE "levels" RENAME COLUMN "description" TO "description_es";

ALTER TABLE "courses" RENAME COLUMN "title" TO "title_es";
ALTER TABLE "courses" RENAME COLUMN "description" TO "description_es";

ALTER TABLE "units" RENAME COLUMN "title" TO "title_es";
ALTER TABLE "units" RENAME COLUMN "description" TO "description_es";

ALTER TABLE "lessons" RENAME COLUMN "title" TO "title_es";
ALTER TABLE "lessons" RENAME COLUMN "description" TO "description_es";

ALTER TABLE "flashcard_sets" RENAME COLUMN "name" TO "name_es";
ALTER TABLE "flashcard_sets" RENAME COLUMN "description" TO "description_es";

-- Index names do not follow their columns. RENAME COLUMN rewrites each index's
-- definition, so all of these keep working and keep being chosen — but they
-- keep the old name, and Prisma compares by name. Left alone, the next
-- `migrate dev` reports drift and proposes dropping and rebuilding all five.
--
-- entries_live_idx and translations_live_idx are deliberately absent: they are
-- the partial indexes from 20260815160500, and their names never mentioned a
-- column, so the definition rewrite is all they need.
ALTER INDEX "entries_nahuat_content_key" RENAME TO "entries_nawat_content_key";
ALTER INDEX "entries_nahuat_content_trgm_idx" RENAME TO "entries_nawat_content_trgm_idx";
ALTER INDEX "dialects_name_key" RENAME TO "dialects_name_es_key";
ALTER INDEX "translations_spanish_content_trgm_idx" RENAME TO "translations_content_es_trgm_idx";
ALTER INDEX "translations_english_content_trgm_idx" RENAME TO "translations_content_en_trgm_idx";

-- The two speculative btrees, dropped rather than renamed.
--
-- They are not redundant with the trigram indexes — btree serves equality,
-- prefix and ORDER BY, which GIN does not — but no query has ever needed them,
-- and the query layer they were guessed for still does not exist. Re-adding
-- one is a single line once an EXPLAIN asks for it.
DROP INDEX "translations_spanish_content_idx";
DROP INDEX "translations_english_content_idx";
