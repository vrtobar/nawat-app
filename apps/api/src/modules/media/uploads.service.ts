import { prisma } from '@nahuat/database';
import {
  MAX_UNRESOLVED_UPLOADS,
  type MediaAsset,
  type PresignedUpload,
  type PresignUpload,
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
import { StorageService } from './storage.service';

@Injectable()
export class UploadsService {
  constructor(private readonly storage: StorageService) {}

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
    return toMediaAsset(updated);
  }

  // An uploader's own assets, newest first. Scoped to the caller: an
  // unattached upload is not content yet, so there is nothing for another
  // contributor to collaborate on.
  async list(userId: string): Promise<MediaAsset[]> {
    const rows = await prisma.mediaAsset.findMany({
      where: { uploaderId: userId },
      select: MEDIA_ASSET_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMediaAsset);
  }
}
