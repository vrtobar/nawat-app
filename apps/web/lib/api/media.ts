import {
  AdminMediaAssetSchema,
  MediaAssetSchema,
  type MediaStatus,
  PresignedUploadSchema,
  type PresignUpload,
  UploadListItemSchema,
} from '@nahuat/shared';
import { z } from 'zod';

import { authedItem, mutate } from './client';

// Typed wrappers over the media routes, matching ./admin.ts. Every one of these
// is called from a Server Action rather than a component: the access token is
// held on the encrypted JWT and the session callback withholds it, so the
// browser cannot make these calls itself — and only a Server Action can persist
// a rotated refresh token, which ./auth.ts explains.
//
// THE ONE CALL THAT IS NOT HERE is the PUT of the bytes to S3. That goes from
// the browser straight to S3 against a presigned URL, which is the entire point
// of presigning, and it is the only step of the upload path this API is not in.
//
// LISTS COME BACK AS BARE ARRAYS, not paginated envelopes — the API returns
// `MediaAsset[]` and `AdminMediaAsset[]` — so they use `authedItem` with
// `z.array(...)` rather than `authedPage`. That differs from ./admin.ts's entry
// lists deliberately; reaching for the familiar helper would fail at the
// envelope parse, which is a confusing place to learn about it.

// -----------------------------------------------------------------------------
// UPLOADS — CONTRIBUTOR
// -----------------------------------------------------------------------------

// POST /uploads/presign — creates the row at AWAITING_UPLOAD and returns a
// write capability, before any bytes exist.
//
// `contentType` and `sizeBytes` are signed into the URL, so S3 itself rejects a
// body that disagrees with what was declared. They are constraints rather than
// claims, which is why the form validates against the same ACCEPTED_MEDIA_TYPES
// and MAX_UPLOAD_BYTES the API enforces instead of keeping its own limits.
//
// What comes back carries NO readable URL. None exists yet: nothing is served
// until an admin approves the asset, and a predicted CDN address would be wrong
// until then and misleading before processing finishes.
//
// `headers` must be sent on the PUT verbatim — they are part of what was
// signed. One exception the caller has to handle: `Content-Length` is a
// forbidden header name that no script can set, and the browser writes it from
// the body anyway, so it is filtered out rather than looped over blindly.
export function presignUpload(body: PresignUpload) {
  return mutate('/uploads/presign', {
    method: 'POST',
    body,
    schema: PresignedUploadSchema,
  });
}

// POST /uploads/:id/uploaded — the pivot, and the point the asset becomes the
// processor's problem.
//
// Separate from the PUT because the PUT never reaches this API. The server
// HEADs the object rather than believing the client: "I uploaded it" is not
// evidence that anything is in the bucket, and the actual size is compared
// against the size that was signed. Only then does the row move to PENDING and
// a message go on the queue — in that order, or a fast consumer reads the row
// before the write is visible.
export function completeUpload(assetId: string) {
  return mutate(`/uploads/${encodeURIComponent(assetId)}/uploaded`, {
    method: 'POST',
    schema: MediaAssetSchema,
  });
}

// GET /uploads — every asset this caller has uploaded, newest first, each with
// what it is attached to.
//
// The attachment is why this list is worth showing: an unattached asset renders
// in no editor, because nothing points at it, so this is the only place one can
// be found.
//
// ⚠️ UNPAGINATED AND UNFILTERED, which is a property of the route rather than
// an omission here: the API selects on `uploaderId` alone. That suits a person
// looking over their own recent work. It is the wrong way to read ONE asset's
// status — see `getUpload` below.
export function listUploads() {
  return authedItem('/uploads', z.array(UploadListItemSchema));
}

// -----------------------------------------------------------------------------
// ATTACHMENT — CONTRIBUTOR
// -----------------------------------------------------------------------------

// PUT /translations/:id/audio and PUT /entries/:id/image.
//
// NO expectedUpdatedAt, unlike every other write to these rows. Attaching sets
// a foreign key and deliberately does not move the parent's `updatedAt`
// (docs/adr/0020), so there is no version to contend for — and demanding one
// would make a recording fail because somebody else fixed a gloss. The media
// widget therefore sits outside the card's optimistic lock and must not touch
// its `expectedUpdatedAt`.
//
// Order-independent: an asset may be attached before or after it finishes
// processing, and may sit unattached indefinitely. Two callers attaching to the
// same row is settled by the unique constraint underneath — a race with one
// winner, rather than a lost update.
export function attachAudio(translationId: string, assetId: string) {
  return mutate(`/translations/${encodeURIComponent(translationId)}/audio`, {
    method: 'PUT',
    body: { assetId },
  });
}

export function detachAudio(translationId: string) {
  return mutate(`/translations/${encodeURIComponent(translationId)}/audio`, {
    method: 'DELETE',
  });
}

export function attachImage(entryId: string, assetId: string) {
  return mutate(`/entries/${encodeURIComponent(entryId)}/image`, {
    method: 'PUT',
    body: { assetId },
  });
}

export function detachImage(entryId: string) {
  return mutate(`/entries/${encodeURIComponent(entryId)}/image`, {
    method: 'DELETE',
  });
}

// -----------------------------------------------------------------------------
// REVIEW — ADMIN
// -----------------------------------------------------------------------------

// GET /admin/media — the review queue.
//
// Defaults, applied by the API rather than here, are `status=READY` and
// `isPublished=false`: processed and not yet decided, which is the set a
// reviewer is there to act on. The other combinations exist for looking into a
// specific failure, so both parameters are passed through.
//
// Rows carry `previewUrl`, a short-lived presigned GET against `pending/`.
// Review plays the recording through that and never through the CDN, which
// cannot address unapproved media at all — that is what the prefix split buys.
export function listMediaForReview(params: { status?: MediaStatus; isPublished?: boolean } = {}) {
  return authedItem('/admin/media', z.array(AdminMediaAssetSchema), {
    status: params.status,
    // Forwarded only when set. The API parses it with z.stringbool() and
    // applies its own default when the key is absent, so sending `false`
    // unconditionally would quietly make that default unreachable.
    isPublished: params.isPublished,
  });
}

// POST /admin/media/:id/publish — the approval gate, and the only writer of
// `audioUrl` and `imageUrl`.
//
// POST rather than PATCH because publishing is not a field an admin sets: it
// copies each derivative from `pending/` to `public/`, verifies the copies
// landed, and only then writes the URL onto the parent row. A populated URL
// therefore asserts three things at once — processed, retrievable, approved.
//
// Refused for an asset that is not READY, and for one attached to nothing:
// approval writes a URL onto a parent, and an unattached asset has none.
export function publishMediaAsset(assetId: string) {
  return mutate(`/admin/media/${encodeURIComponent(assetId)}/publish`, {
    method: 'POST',
    schema: AdminMediaAssetSchema,
  });
}

// POST /admin/media/:id/unpublish — removes the `public/` objects and clears
// the URL. `pending/` is left alone, so republishing needs no reprocessing.
export function unpublishMediaAsset(assetId: string) {
  return mutate(`/admin/media/${encodeURIComponent(assetId)}/unpublish`, {
    method: 'POST',
    schema: AdminMediaAssetSchema,
  });
}

// -----------------------------------------------------------------------------
// STATUS
// -----------------------------------------------------------------------------

// GET /uploads/:id — one asset, which is what the upload widget polls while the
// processor works.
//
// DELIBERATELY NOT `listUploads()` FILTERED CLIENT-SIDE. Processing takes tens
// of seconds — 26.6s measured on a cold Lambda, 2.3s warm — so this is called
// repeatedly for a single row, and reading it out of the caller's whole upload
// history would re-transfer every recording that contributor has ever made on
// every tick. The cost would grow with how much work the person had done.
//
// Poll at about 2s with a ceiling near 60s, then offer a manual re-check rather
// than declaring failure: a short fixed timeout reports the first upload of
// every session as broken, because that one pays the cold start.
export function getUpload(assetId: string) {
  return authedItem(`/uploads/${encodeURIComponent(assetId)}`, MediaAssetSchema);
}
