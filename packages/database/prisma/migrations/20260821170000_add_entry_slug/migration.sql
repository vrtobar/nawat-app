-- Add the canonical URL slug to entries.
--
-- NO BACKFILL: the column is added NOT NULL with no default, which is valid
-- only because `entries` is empty everywhere this migration runs — a fresh dev
-- reset (the seed generates slugs via slugifyNawat), and production, which is
-- pre-dictionary and receives content only after this ships, entered through
-- the admin (which generates the slug in app code). If `entries` ever held rows
-- when this ran, it would need a backfill before the NOT NULL. See
-- docs/adr/0016-dictionary-entry-slugs.
--
-- The slug is derived from nawat_content by slugifyNawat (@nahuat/shared); the
-- UNIQUE index is the guard that makes a fold-collision — two distinct
-- headwords that slug to the same value — fail loudly (ENTRY_SLUG_CONFLICT)
-- rather than silently overwrite addressing.

-- AlterTable
ALTER TABLE "entries" ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "entries_slug_key" ON "entries"("slug");
