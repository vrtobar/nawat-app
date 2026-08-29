import { prisma } from '@nahuat/database';
import type { MediaAsset, MediaKind, Role } from '@nahuat/shared';
import { Injectable } from '@nestjs/common';

import { entryNotFound, translationNotFound } from '../dictionary/dictionary-errors';
import { MEDIA_ASSET_SELECT, toMediaAsset } from './media-asset';
import {
  mediaAlreadyAttached,
  mediaAssetNotFound,
  mediaInvalidState,
  mediaKindMismatch,
  publishedMediaChangeForbidden,
  uploadNotYours,
} from './media-errors';

// Attaching media is NOT an edit of the row it hangs from (docs/adr/0020), and
// the writes below are raw for exactly that reason.
//
// `updatedAt` carries `@updatedAt`, so any Prisma update bumps it — and the
// entry editor sends that timestamp back as its optimistic lock. A recording
// attached through Prisma would therefore invalidate an open editing session
// and answer the author with EDIT_CONFLICT for a change that touched no field
// they can see. The ADR's promise that "a recording and a typo fix can land at
// the same time" is only true if this column stays still, and raw SQL is what
// keeps it still.
//
// The same reasoning is why there is no expectedUpdatedAt on these endpoints:
// there is nothing to contend for. Two people attaching audio to one
// translation is settled by the unique constraint, not by a lock.
@Injectable()
export class AttachmentsService {
  async attachAudio(
    userId: string,
    role: Role,
    translationId: string,
    assetId: string,
  ): Promise<MediaAsset> {
    const translation = await prisma.translation.findFirst({
      where: { id: translationId, deletedAt: null },
      select: { id: true, audioAsset: { select: { id: true, isPublished: true } } },
    });
    if (!translation) throw translationNotFound();

    // Replacing live media is an admin's call; adding where there is none is
    // not. A published translation with no recording is precisely the case the
    // sub-resource exists for.
    assertMayReplace(translation.audioAsset, role);

    const asset = await loadAttachable(userId, role, assetId, 'AUDIO', translationId);

    // audio_url cleared in the same statement. It described the OUTGOING
    // asset's approved derivative; leaving it would point a published
    // translation at one recording while its asset column named another, which
    // is the desynchronised state the whole gate exists to prevent. The
    // incoming asset earns a URL when an admin approves it and not before.
    const written = await prisma.$executeRaw`
      UPDATE translations
      SET audio_asset_id = ${assetId}, audio_url = NULL
      WHERE id = ${translationId} AND deleted_at IS NULL
    `;
    // THE WRITE IS THE AUTHORITY, not the read above — the same discipline as
    // the conditional updates in the dictionary services. The row can be soft
    // deleted between the two, and reporting success for a statement that
    // changed nothing is the silent half of that failure.
    if (written === 0) throw translationNotFound();

    return toMediaAsset(asset);
  }

  async detachAudio(role: Role, translationId: string): Promise<void> {
    const translation = await prisma.translation.findFirst({
      where: { id: translationId, deletedAt: null },
      select: { id: true, audioAsset: { select: { id: true, isPublished: true } } },
    });
    if (!translation) throw translationNotFound();
    assertMayReplace(translation.audioAsset, role);

    // Idempotent: detaching audio that is not there is not an error. The caller
    // wanted no audio and there is none.
    const written = await prisma.$executeRaw`
      UPDATE translations
      SET audio_asset_id = NULL, audio_url = NULL
      WHERE id = ${translationId} AND deleted_at IS NULL
    `;
    if (written === 0) throw translationNotFound();
  }

  async attachImage(
    userId: string,
    role: Role,
    entryId: string,
    assetId: string,
  ): Promise<MediaAsset> {
    const entry = await prisma.entry.findFirst({
      where: { id: entryId, deletedAt: null },
      select: { id: true, imageAsset: { select: { id: true, isPublished: true } } },
    });
    if (!entry) throw entryNotFound();
    assertMayReplace(entry.imageAsset, role);

    const asset = await loadAttachable(userId, role, assetId, 'IMAGE', entryId);

    const written = await prisma.$executeRaw`
      UPDATE entries
      SET image_asset_id = ${assetId}, image_url = NULL
      WHERE id = ${entryId} AND deleted_at IS NULL
    `;
    if (written === 0) throw entryNotFound();

    return toMediaAsset(asset);
  }

  async detachImage(role: Role, entryId: string): Promise<void> {
    const entry = await prisma.entry.findFirst({
      where: { id: entryId, deletedAt: null },
      select: { id: true, imageAsset: { select: { id: true, isPublished: true } } },
    });
    if (!entry) throw entryNotFound();
    assertMayReplace(entry.imageAsset, role);

    const written = await prisma.$executeRaw`
      UPDATE entries
      SET image_asset_id = NULL, image_url = NULL
      WHERE id = ${entryId} AND deleted_at IS NULL
    `;
    if (written === 0) throw entryNotFound();
  }
}

// Removing or replacing media a reviewer already approved is an ADMIN action.
// Absent media, or media still awaiting review, is anyone's to change.
function assertMayReplace(current: { isPublished: boolean } | null, role: Role): void {
  if (current?.isPublished && role !== 'ADMIN') throw publishedMediaChangeForbidden();
}

// Everything an asset must satisfy to be hung on a row, in the order that gives
// the most useful refusal: exists, is the right kind, is the caller's, is not
// broken, is not already spoken for.
async function loadAttachable(
  userId: string,
  role: Role,
  assetId: string,
  kind: MediaKind,
  targetId: string,
) {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      ...MEDIA_ASSET_SELECT,
      uploaderId: true,
      entry: { select: { id: true } },
      translation: { select: { id: true } },
    },
  });
  if (!asset) throw mediaAssetNotFound();
  if (asset.kind !== kind) throw mediaKindMismatch(kind, asset.kind);
  if (asset.uploaderId !== userId && role !== 'ADMIN') throw uploadNotYours();

  // A FAILED asset has no derivatives and never will without a fresh upload, so
  // attaching one would put a row in a state no approval can complete.
  // AWAITING_UPLOAD and PENDING are both fine: attaching is independent of
  // processing, and attaching early is the normal flow.
  if (asset.status === 'FAILED') throw mediaInvalidState(asset.status);

  // The unique constraints would catch this, but as a P2002 naming a column.
  // Checked here so the answer names the situation instead.
  const attachedTo = asset.entry?.id ?? asset.translation?.id;
  if (attachedTo !== undefined && attachedTo !== targetId) throw mediaAlreadyAttached();

  return asset;
}
