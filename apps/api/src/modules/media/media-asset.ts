import type { MediaAsset } from '@nahuat/shared';

// The columns making up the MediaAsset contract, and the mapping to it. Shared
// by the uploads and attachment services so the projection cannot drift between
// them — the same reasoning as TRANSLATION_DETAIL_SELECT in the dictionary.
//
// `sourceKey` and `derivatives` are deliberately absent: where the bytes live
// is internal, and a caller that needs to render media reads the URL on the
// entry or translation, which exists only once an admin has approved it.
export const MEDIA_ASSET_SELECT = {
  id: true,
  kind: true,
  status: true,
  contentType: true,
  sizeBytes: true,
  error: true,
  notes: true,
  isPublished: true,
  createdAt: true,
} as const;

export type MediaAssetRow = {
  id: string;
  kind: MediaAsset['kind'];
  status: MediaAsset['status'];
  contentType: string;
  sizeBytes: number;
  error: string | null;
  notes: string | null;
  isPublished: boolean;
  createdAt: Date;
};

// Prisma hands back a Date; the contract is an ISO string. Mapped explicitly
// rather than left to the JSON serializer, matching toAdminEntryDetail and
// toUserProfile — the response shape is then checked by the compiler instead of
// depending on how a Date happens to stringify.
export function toMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    error: row.error,
    notes: row.notes,
    isPublished: row.isPublished,
    createdAt: row.createdAt.toISOString(),
  };
}
