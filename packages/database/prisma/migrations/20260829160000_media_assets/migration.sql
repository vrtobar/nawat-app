-- MediaAsset: audio recordings and images as a table, replacing the two
-- nullable key columns that nothing ever wrote.
--
-- WHY A TABLE (docs/adr/0020). Processing is asynchronous, so a URL written at
-- upload time can point at media that never becomes ready — a failure that is
-- silent by construction, since nothing errors and the only way to find it is
-- for a person to press play. Derivatives are also plural, retries need state,
-- and provenance has nowhere to live in a nullable string.
--
-- DESTRUCTIVE, AND DELIBERATELY SO. entries.image_key and
-- translations.audio_key are dropped rather than migrated. Both are NULL in
-- every row in every environment: no code path has ever written either, and
-- production serves zero entries. Verified on the local database, which holds
-- the largest content set anywhere right now — 42 entries and 49 translations,
-- 0 of each with a key set. The same check is worth repeating before this runs
-- against content, because past that point it becomes a data migration rather
-- than a schema one.

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('AUDIO', 'IMAGE');

-- The pipeline's state, not the reviewer's — is_published below is separate and
-- neither implies the other.
--
-- AWAITING_UPLOAD is NOT in ADR 20, which specifies PENDING -> READY | FAILED.
-- The row is created at presign, before any bytes exist, so one PENDING would
-- mean both "the browser has not uploaded yet" and "uploaded, waiting on the
-- processor". ADR 20 makes an asset stuck in PENDING a monitored condition —
-- the signal that a queue or consumer is broken — and abandoned uploads would
-- drown that signal from the first day. Split, PENDING means exactly "queued
-- and unprocessed", and the abandoned set is precisely what a future reaper
-- needs to reclaim orphaned objects.
CREATE TYPE "MediaStatus" AS ENUM ('AWAITING_UPLOAD', 'PENDING', 'READY', 'FAILED');

-- AlterEnum
--
-- Added and not used in this migration. Postgres permits
-- ALTER TYPE ... ADD VALUE inside a transaction but forbids USING the new value
-- in that same transaction, so a migration doing both would fail — the same
-- constraint recorded in 20260828151500_add_import_provider.
ALTER TYPE "EntityType" ADD VALUE 'MEDIA_ASSET';

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "source_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "derivatives" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "uploader_id" TEXT NOT NULL,
    "notes" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "published_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- AlterTable
--
-- The foreign key sits on the owning row, not on media_assets. That is what
-- lets an asset exist before it finds a parent — uploads are not attached at
-- creation — and what keeps the public read a single query with no join.
ALTER TABLE "entries" DROP COLUMN "image_key",
ADD COLUMN     "image_asset_id" TEXT;

-- AlterTable
ALTER TABLE "translations" DROP COLUMN "audio_key",
ADD COLUMN     "audio_asset_id" TEXT;

-- CreateIndex
CREATE INDEX "media_assets_status_idx" ON "media_assets"("status");

-- CreateIndex
CREATE INDEX "media_assets_uploader_id_idx" ON "media_assets"("uploader_id");

-- CreateIndex
--
-- UNIQUE: one asset serves at most one parent. It also gives each attach path
-- an index for the reverse lookup from an asset back to its owner, which the
-- review queue does on every row.
CREATE UNIQUE INDEX "entries_image_asset_id_key" ON "entries"("image_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "translations_audio_asset_id_key" ON "translations"("audio_asset_id");

-- AddForeignKey
--
-- RESTRICT rather than SET NULL on both parents. Detaching media is what the
-- sub-resource DELETE endpoints are for; letting a row deletion do it silently
-- would route around that model, and it matches every other content foreign key
-- in this schema.
ALTER TABLE "entries" ADD CONSTRAINT "entries_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
--
-- The admin review queue. Hand-written because Prisma cannot express a WHERE
-- clause on an index — the same constraint, and the same maintenance hazard, as
-- entries_drafts_idx and 20260815160500_partial_live_indexes.
--
-- WHAT IT SERVES. GET /admin/media, whose whole purpose is the set awaiting a
-- decision:
--   WHERE status = 'READY' AND NOT is_published ORDER BY created_at
-- media_assets_status_idx cannot serve it well: status alone does not narrow to
-- the unreviewed, and the pending set is the one that has to stay fast as the
-- reviewed set grows without bound behind it.
--
-- WHY created_at ASCENDING, against the house habit of newest-first. A review
-- queue is worked oldest-first, so the oldest unreviewed recording is not
-- buried under newer arrivals — the failure this queue exists to prevent is a
-- contribution sitting unnoticed.
--
-- MAINTENANCE. A partial index is used only when the query's WHERE implies its
-- predicate. If the queue filter stops being exactly
-- `status: READY, isPublished: false`, this silently stops being used — no
-- error, just a sequential scan. Re-check with EXPLAIN.
CREATE INDEX "media_assets_review_queue_idx" ON "media_assets" ("created_at")
  WHERE "status" = 'READY' AND NOT "is_published";
