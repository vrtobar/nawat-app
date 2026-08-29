import { prisma } from '@nahuat/database';
import {
  type AdminMediaAsset,
  type MediaDerivatives,
  MediaDerivativesSchema,
  type MediaQuery,
} from '@nahuat/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MEDIA_ASSET_SELECT, toMediaAsset } from './media-asset';
import {
  mediaAssetNotFound,
  mediaDerivativesInvalid,
  mediaInvalidState,
  mediaNotAttached,
} from './media-errors';
import { cdnUrlFor, derivativeKey, MEDIA_PREFIX } from './media-keys';
import { StorageService } from './storage.service';

// Everything a reviewer sees, plus what publication needs to act. `derivatives`
// is selected here and nowhere else in the module — it is the processor's
// output, internal to the gate, and it never reaches a response.
const REVIEW_SELECT = {
  ...MEDIA_ASSET_SELECT,
  derivatives: true,
  uploader: { select: { id: true, name: true, email: true } },
  entry: { select: { id: true, nawatContent: true } },
  translation: { select: { id: true, entry: { select: { nawatContent: true } } } },
} as const;

// THE APPROVAL GATE (docs/adr/0020). Publication is a MOVE BETWEEN PREFIXES,
// not a flag: derivatives are copied from `pending/` into `public/`, which is
// the only prefix CloudFront can read. A boolean alone would leave every
// unapproved recording retrievable by anyone holding its key, making the gate a
// convention rather than a boundary.
//
// Writing `audioUrl` / `imageUrl` is the LAST step and happens nowhere else in
// the codebase. That is what lets the public read path be a single query with
// no join: a populated URL asserts processed, verified and approved, all three,
// because nothing else can put one there.
@Injectable()
export class ReviewService {
  constructor(
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  // Defaults to the set a reviewer is there to act on. Ordered oldest first,
  // matching media_assets_review_queue_idx — a queue worked newest-first buries
  // the contribution that has waited longest, which is the failure a review
  // queue exists to prevent.
  async list(query: MediaQuery): Promise<AdminMediaAsset[]> {
    const rows = await prisma.mediaAsset.findMany({
      where: {
        status: query.status ?? 'READY',
        isPublished: query.isPublished ?? false,
      },
      select: REVIEW_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(rows.map((row) => this.toAdminAsset(row)));
  }

  async publish(adminId: string, assetId: string): Promise<AdminMediaAsset> {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: REVIEW_SELECT,
    });
    if (!asset) throw mediaAssetNotFound();

    // READY only. A PENDING asset has not been processed and a FAILED one never
    // will be — ADR 20's rule that review state never implies processing state
    // runs in this direction too.
    if (asset.status !== 'READY') throw mediaInvalidState(asset.status);
    if (asset.isPublished) return this.toAdminAsset(asset);

    const target = asset.entry ?? asset.translation;
    if (!target) throw mediaNotAttached();

    const derivatives = parseDerivatives(asset.derivatives);

    // Copy first, database last. If a copy fails the asset stays unpublished
    // and the parent keeps no URL, so the failure is a retryable no-op. The
    // reverse order would leave a row advertising media that is not there —
    // and objects in `public/` that nothing points at are harmless by
    // comparison.
    for (const file of derivatives.files) {
      await this.storage.copy(
        derivativeKey(MEDIA_PREFIX.pending, asset.id, file.key),
        derivativeKey(MEDIA_PREFIX.public, asset.id, file.key),
      );
    }

    // Verified rather than assumed, the same discipline ADR 20 asks of the
    // processor: a copy that returned without error is not evidence the object
    // is readable at the address about to be published.
    const primaryKey = derivativeKey(MEDIA_PREFIX.public, asset.id, derivatives.primary);
    if (!(await this.storage.head(primaryKey))) {
      throw mediaDerivativesInvalid('the approved file is not readable after copying');
    }

    const url = cdnUrlFor(this.config.getOrThrow<string>('CDN_URL'), asset.id, derivatives.primary);

    // One transaction. The asset's approval and the URL that depends on it must
    // not be separable — a published asset whose parent has no URL is invisible,
    // and a parent with a URL whose asset is unpublished is the leak.
    await prisma.$transaction(async (tx) => {
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: { isPublished: true, publishedAt: new Date(), publishedById: adminId },
      });

      // Raw, for the same reason attaching is raw: approving media must not
      // bump the parent's updatedAt and break an open editor's optimistic lock.
      if (asset.translation) {
        await tx.$executeRaw`
          UPDATE translations SET audio_url = ${url} WHERE id = ${asset.translation.id}
        `;
      } else {
        await tx.$executeRaw`
          UPDATE entries SET image_url = ${url} WHERE id = ${asset.entry?.id}
        `;
      }
    });

    return this.toAdminAsset({ ...asset, isPublished: true });
  }

  async unpublish(assetId: string): Promise<AdminMediaAsset> {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: REVIEW_SELECT,
    });
    if (!asset) throw mediaAssetNotFound();
    if (!asset.isPublished) return this.toAdminAsset(asset);

    // Database first here, the mirror of publish. Clearing the URL is what
    // makes the media unreachable; deleting the objects afterwards is cleanup.
    // Deleting first would leave a row pointing at a 404 for as long as the
    // transaction took.
    await prisma.$transaction(async (tx) => {
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: { isPublished: false, publishedAt: null, publishedById: null },
      });
      if (asset.translation) {
        await tx.$executeRaw`
          UPDATE translations SET audio_url = NULL WHERE id = ${asset.translation.id}
        `;
      } else if (asset.entry) {
        await tx.$executeRaw`
          UPDATE entries SET image_url = NULL WHERE id = ${asset.entry.id}
        `;
      }
    });

    // The pending copies are deliberately kept: they are what a re-approval
    // copies from, so unpublishing is reversible without re-running the
    // processor.
    const derivatives = tryParseDerivatives(asset.derivatives);
    for (const file of derivatives?.files ?? []) {
      await this.storage.delete(derivativeKey(MEDIA_PREFIX.public, asset.id, file.key));
    }

    return this.toAdminAsset({ ...asset, isPublished: false });
  }

  private async toAdminAsset(row: {
    derivatives: unknown;
    uploader: { id: string; name: string | null; email: string };
    entry: { id: string; nawatContent: string } | null;
    translation: { id: string; entry: { nawatContent: string } } | null;
    [key: string]: unknown;
  }): Promise<AdminMediaAsset> {
    const asset = toMediaAsset(row as never);

    const attachedTo = row.entry
      ? ({ kind: 'ENTRY', id: row.entry.id, nawatContent: row.entry.nawatContent } as const)
      : row.translation
        ? ({
            kind: 'TRANSLATION',
            id: row.translation.id,
            nawatContent: row.translation.entry.nawatContent,
          } as const)
        : null;

    // Signed against the PENDING prefix, which is the only place an unapproved
    // derivative exists. Absent when there is nothing to hear yet — an asset
    // still processing, or one whose processor wrote something unusable.
    const derivatives = tryParseDerivatives(row.derivatives);
    const previewUrl = derivatives
      ? await this.storage.presignGet(
          derivativeKey(MEDIA_PREFIX.pending, asset.id, derivatives.primary),
        )
      : null;

    return { ...asset, uploader: row.uploader, attachedTo, previewUrl };
  }
}

// The processor's output is a JSON column, so it is whatever was written there
// — including nothing, or something an older processor wrote. Parsed rather
// than trusted, and the failure names the pipeline instead of surfacing as a
// TypeError halfway through a copy loop.
function parseDerivatives(value: unknown): MediaDerivatives {
  const parsed = tryParseDerivatives(value);
  if (!parsed) throw mediaDerivativesInvalid('its processed files are missing or unreadable');
  if (!parsed.files.some((file) => file.key === parsed.primary)) {
    throw mediaDerivativesInvalid('the file it names as primary is not among its processed files');
  }
  return parsed;
}

function tryParseDerivatives(value: unknown): MediaDerivatives | undefined {
  const result = MediaDerivativesSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
