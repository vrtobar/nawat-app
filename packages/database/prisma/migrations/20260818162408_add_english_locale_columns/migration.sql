-- The additive half of the localized-content work: the English columns the
-- renames in 20260818160004 made room for, plus the locale that selects
-- between them. Nothing here renames, and only two blocks needed hand-editing.

-- Which language content is served in. Uppercase to match Role, EntryType and
-- the rest; the wire format is lowercase and the column suffix is capitalized.
--
-- Nawat is absent on purpose. It is the subject being taught — shown to every
-- learner whatever their language — so it is never a value selected between.
-- Adding it here would make every locale switch statement carry a case that
-- must never be reached.
CREATE TYPE "Locale" AS ENUM ('ES', 'EN');

ALTER TABLE "users" ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'ES';

-- English required to publish, not to create (ADR 15 §2). Every one of these
-- is nullable for that reason: a Nawat speaker recording vocabulary must not
-- be blocked on producing an English gloss they may not be able to write. The
-- publish guards are what require them, and only at the moment content goes
-- live.
ALTER TABLE "levels"  ADD COLUMN "title_en" TEXT, ADD COLUMN "description_en" TEXT;
ALTER TABLE "courses" ADD COLUMN "title_en" TEXT, ADD COLUMN "description_en" TEXT;
ALTER TABLE "units"   ADD COLUMN "title_en" TEXT, ADD COLUMN "description_en" TEXT;
ALTER TABLE "lessons" ADD COLUMN "title_en" TEXT, ADD COLUMN "description_en" TEXT;

-- Without this an English learner gets a Nawat example sentence and no way to
-- read it — the one field ADR 15 adds rather than renames.
ALTER TABLE "translations" ADD COLUMN "example_en" TEXT;

-- Dialects are the exception: required in both languages.
--
-- HAND-EDITED. Prisma emits ADD COLUMN ... TEXT NOT NULL, which fails against
-- any existing row, so this is the add / backfill / constrain form instead.
-- The backfill duplicates values the seed also owns, which is not ideal and is
-- unavoidable: a migration has to leave the table valid on its own, and it
-- cannot call the seed. The seed's upsert re-asserts them on every run, so the
-- two cannot drift for long.
--
-- Affects one row locally and zero in production, where the reference seed has
-- never been run.
ALTER TABLE "dialects" ADD COLUMN "name_en" TEXT, ADD COLUMN "description_en" TEXT;

UPDATE "dialects" SET
  "name_en" = 'Common Nawat',
  "description_en" = 'Forms in broad use among Nawat speakers rather than specific to one community. Shown when an entry has no regional distinction.'
WHERE "code" = 'common';

ALTER TABLE "dialects"
  ALTER COLUMN "name_en" SET NOT NULL,
  ALTER COLUMN "description_en" SET NOT NULL,
  ALTER COLUMN "description_es" SET NOT NULL;

CREATE UNIQUE INDEX "dialects_name_en_key" ON "dialects"("name_en");

-- Flashcard sets: one name required, either language, not both.
--
-- HAND-EDITED for the CHECK — Prisma cannot express one, so this constraint is
-- migration-owned the same way the partial indexes in 20260815160500 are.
--
-- A private set is named once by whoever made it, in their own language. An
-- official set needs both, but that is enforced on the isOfficial toggle
-- alongside the other publish guards, not here: it is a product rule, and a
-- CHECK would also make an admin's half-finished promotion impossible to save.
ALTER TABLE "flashcard_sets"
  ADD COLUMN "name_en" TEXT,
  ADD COLUMN "description_en" TEXT,
  ALTER COLUMN "name_es" DROP NOT NULL;

ALTER TABLE "flashcard_sets" ADD CONSTRAINT "flashcard_sets_name_present"
  CHECK ("name_es" IS NOT NULL OR "name_en" IS NOT NULL);
