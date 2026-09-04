import { prisma } from '@nahuat/database';
import {
  MAX_UNRESOLVED_UPLOADS,
  type MediaAsset,
  type MediaAttachment,
  type PresignedUpload,
  type PresignUpload,
  type UploadListItem,
} from '@nahuat/shared';
import { Injectable } from '@nestjs/common';

import { MEDIA_ASSET_SELECT, toMediaAsset } from './media-asset';
import {
  mediaAssetNotFound,
  mediaInvalidState,
  mediaUploadIncomplete,
  uploadLimitReached,
  uploadNotYours,
} from './media-errors';
import { sourceKeyFor } from './media-keys';
import { QueueService } from './queue.service';
import { StorageService } from './storage.service';

@Injectable()
export class UploadsService {
  constructor(
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  // Creates the asset and hands back a capability to write ONE object at ONE
  // key. The row exists before the bytes do, which is what makes an abandoned
  // upload visible rather than invisible — see the AWAITING_UPLOAD note in
  // schema.prisma.
  async presign(userId: string, input: PresignUpload): Promise<PresignedUpload> {
    const outstanding = await prisma.mediaAsset.count({
      where: { uploaderId: userId, status: 'AWAITING_UPLOAD' },
    });
    if (outstanding >= MAX_UNRESOLVED_UPLOADS) {
      throw uploadLimitReached(MAX_UNRESOLVED_UPLOADS);
    }

    // Two steps rather than one, and the order matters: the key is built from
    // the id, so the row has to exist before the object's address does. The
    // alternative — generating an id client-side or ahead of the insert — would
    // let a caller influence where its bytes land.
    const asset = await prisma.mediaAsset.create({
      data: {
        kind: input.kind,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploaderId: userId,
        // Empty is stored as null rather than "". The column is nullable and
        // null already means "nothing recorded"; an empty string would be a
        // second way to say it, and every reader would have to know both.
        notes: input.notes && input.notes.length > 0 ? input.notes : null,
        // Placeholder for one statement. The column is NOT NULL because an
        // asset without a source location is meaningless, and the update below
        // is in the same request — a row that kept this value would mean the
        // process died between the two, which the reaper treats like any other
        // abandoned AWAITING_UPLOAD row.
        sourceKey: '',
      },
      select: { id: true },
    });

    const sourceKey = sourceKeyFor(asset.id, input.kind, input.contentType);
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { sourceKey },
      select: { id: true },
    });

    const presigned = await this.storage.presignPut(sourceKey, input.contentType, input.sizeBytes);

    return {
      assetId: asset.id,
      uploadUrl: presigned.url,
      headers: presigned.headers,
      expiresInSeconds: presigned.expiresInSeconds,
    };
  }

  // AWAITING_UPLOAD -> PENDING, and the point at which the asset becomes the
  // processor's problem. The queue publish lands here.
  //
  // THE OBJECT IS CHECKED RATHER THAN TRUSTED. A client saying "I uploaded it"
  // is not evidence that anything is in the bucket, and queueing a job for an
  // object that does not exist converts a recoverable client error into a
  // FAILED asset a reviewer has to interpret. HeadObject costs one call and
  // answers the question directly.
  async complete(userId: string, assetId: string): Promise<MediaAsset> {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { ...MEDIA_ASSET_SELECT, uploaderId: true, sourceKey: true },
    });
    if (!asset) throw mediaAssetNotFound();
    if (asset.uploaderId !== userId) throw uploadNotYours();
    if (asset.status !== 'AWAITING_UPLOAD') throw mediaInvalidState(asset.status);

    const object = await this.storage.head(asset.sourceKey);
    if (!object) throw mediaUploadIncomplete('no file was received');
    if (object.sizeBytes !== asset.sizeBytes) {
      throw mediaUploadIncomplete(`expected ${asset.sizeBytes} bytes, found ${object.sizeBytes}`);
    }

    const updated = await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: 'PENDING' },
      select: MEDIA_ASSET_SELECT,
    });

    // AFTER the update commits, never inside it. A consumer that read the row
    // before it was visible would find AWAITING_UPLOAD and fail on an asset
    // that is in fact ready — the same race an S3 notification would have
    // introduced, reintroduced here by construction rather than by chance.
    //
    // A false return is not an error for this caller; QueueService documents
    // why, and the reaper is what recovers the row.
    await this.queue.publishMediaProcessing(assetId);

    return toMediaAsset(updated);
  }

  // ONE asset, for the client watching an upload move PENDING -> READY | FAILED.
  //
  // This exists so that poll does not go through `list`. Processing takes tens
  // of seconds — 26.6s measured on a cold Lambda, 2.3s warm — so a client polls
  // repeatedly for a single row, and reading it out of the caller's whole
  // upload history would re-transfer every recording that contributor has ever
  // made on each tick. The cost of the poll would grow with how much work the
  // person had done, which is precisely backwards.
  //
  // Scoped to the uploader like every other route here, and refused the same
  // way: missing is a 404, someone else's is a 403. The asset is not content
  // until it is attached, so there is nothing for another contributor to read.
  async get(userId: string, assetId: string): Promise<MediaAsset> {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { ...MEDIA_ASSET_SELECT, uploaderId: true },
    });
    if (!asset) throw mediaAssetNotFound();
    if (asset.uploaderId !== userId) throw uploadNotYours();

    return toMediaAsset(asset);
  }

  // An uploader's own assets, newest first. Scoped to the caller: an
  // unattached upload is not content yet, so there is nothing for another
  // contributor to collaborate on.
  //
  // CARRIES THE ATTACHMENT, which is the only reason this list is worth
  // showing. An unattached asset is invisible in every editor by definition —
  // nothing renders it, because nothing points at it — so this is the one place
  // it can be found, and a list that could not say whether an upload had
  // reached anything would not answer the question it exists for.
  async list(userId: string): Promise<UploadListItem[]> {
    const rows = await prisma.mediaAsset.findMany({
      where: { uploaderId: userId },
      select: {
        ...MEDIA_ASSET_SELECT,
        entry: { select: { id: true, nawatContent: true } },
        translation: { select: { id: true, entry: { select: { nawatContent: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => ({ ...toMediaAsset(row), attachedTo: attachmentOf(row) }));
  }
}

// The same derivation review.service makes for its queue rows. An asset points
// at an entry or a translation, never both — the attach endpoints enforce the
// kind — so this reads whichever is set and reports the headword either way.
// A translation's headword lives on its parent entry, which is why the two
// branches differ in depth rather than only in name.
function attachmentOf(row: {
  entry: { id: string; nawatContent: string } | null;
  translation: { id: string; entry: { nawatContent: string } } | null;
}): MediaAttachment {
  if (row.entry) {
    return { kind: 'ENTRY', id: row.entry.id, nawatContent: row.entry.nawatContent };
  }
  if (row.translation) {
    return {
      kind: 'TRANSLATION',
      id: row.translation.id,
      nawatContent: row.translation.entry.nawatContent,
    };
  }
  return null;
}
