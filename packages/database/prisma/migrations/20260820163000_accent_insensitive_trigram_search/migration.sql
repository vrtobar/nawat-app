-- Accent-insensitive trigram search for GET /entries/search.
--
-- The spec (api-reference.md) promises "takat" matches "tàkat". Plain pg_trgm
-- does not give that: "takat" and "tàkat" share no trigrams, so the accented
-- form never matches. Folding accents needs the unaccent extension applied to
-- BOTH the query and the indexed column.
--
-- Entirely hand-written, and it must be. Prisma cannot model a functional index
-- expression (immutable_unaccent(col)), so these GIN indexes can no more live in
-- schema.prisma than the partial *_live_idx indexes can. The three raw-column
-- trigram @@index lines were removed from schema.prisma in the same change; the
-- DROP INDEX statements below are what reconciles the migration history with
-- that removal, so `migrate dev` sees no drift and generates nothing further.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is STABLE, not IMMUTABLE — it reads a text-search dictionary that
-- is technically mutable, so Postgres refuses it directly in an index
-- expression ("functions in index expression must be marked IMMUTABLE"). The
-- documented workaround is a thin IMMUTABLE wrapper that pins the dictionary by
-- name (the two-argument form, so the result cannot vary with search_path).
--
-- The IMMUTABLE label is a promise: do not change the `unaccent` dictionary
-- under these indexes. If it ever changes, REINDEX them — a stale functional
-- index would silently return wrong matches, not an error.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT unaccent('unaccent', $1) $$;

-- Replace, not augment. The raw-column trigram indexes served exactly one
-- caller — GET /entries/search — and that query now wraps every column in
-- immutable_unaccent(), so the raw indexes can never be chosen again and would
-- be dead weight. Drop them and index the expression the query actually uses.
-- Re-adding a raw-column index later is one line, if a case-sensitive search
-- ever needs one.
DROP INDEX "entries_nawat_content_trgm_idx";
DROP INDEX "translations_content_es_trgm_idx";
DROP INDEX "translations_content_en_trgm_idx";

CREATE INDEX "entries_nawat_content_unaccent_trgm_idx"
  ON "entries" USING gin (immutable_unaccent("nawat_content") gin_trgm_ops);
CREATE INDEX "translations_content_es_unaccent_trgm_idx"
  ON "translations" USING gin (immutable_unaccent("content_es") gin_trgm_ops);
CREATE INDEX "translations_content_en_unaccent_trgm_idx"
  ON "translations" USING gin (immutable_unaccent("content_en") gin_trgm_ops);
