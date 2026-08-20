-- Reshape translation ordering: dialect precedence replaces within-dialect
-- priority.
--
-- Within-dialect `priority` is removed. A word's several senses now live in a
-- pipe-separated gloss on a single row ("hombre | persona") rather than several
-- rows, so nothing orders translations within a dialect. A dialect has at most
-- one translation per entry (the unique constraint narrows from the triple to
-- the pair), and Dialect.precedence orders an entry's translations across
-- dialects. See schema.prisma (Translation @@unique, Dialect.precedence) and
-- CreateTranslation in packages/shared.
--
-- translations_live_idx is a hand-written partial index Prisma cannot see; it
-- was keyed on (entry_id, priority). It is dropped before the column and
-- recreated on (entry_id) alone, with the Prisma-managed drops between.

DROP INDEX "translations_live_idx";

DROP INDEX "translations_entry_id_dialect_code_priority_key";
ALTER TABLE "translations" DROP COLUMN "priority";
CREATE UNIQUE INDEX "translations_entry_id_dialect_code_key"
  ON "translations" ("entry_id", "dialect_code");

CREATE INDEX "translations_live_idx" ON "translations" ("entry_id")
  WHERE "is_published" AND "deleted_at" IS NULL;

-- Dialect precedence: display order across dialects, lower first. NOT NULL with
-- a default so existing rows populate without a backfill; not unique, so the
-- shared default is legal, and the seed then sets real values (common 0, towns
-- 10/20/…).
ALTER TABLE "dialects" ADD COLUMN "precedence" INTEGER NOT NULL DEFAULT 100;
