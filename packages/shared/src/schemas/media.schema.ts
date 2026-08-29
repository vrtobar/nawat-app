import { z } from 'zod';

// =============================================================================
// MEDIA
// Contracts for uploading audio and images. The pipeline behind them is
// docs/adr/0020: an upload becomes a MediaAsset, the asset is processed
// asynchronously, and an ADMIN approving it is what publishes a URL.
// =============================================================================

export const MediaKindSchema = z.enum(['AUDIO', 'IMAGE']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

// AWAITING_UPLOAD is not in ADR 20 — see the enum comment in schema.prisma for
// why the state the row is created in is distinct from the one that means
// "queued and unprocessed".
export const MediaStatusSchema = z.enum(['AWAITING_UPLOAD', 'PENDING', 'READY', 'FAILED']);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

// -----------------------------------------------------------------------------
// WHAT MAY BE UPLOADED
// -----------------------------------------------------------------------------

// Content type -> the extension the stored object gets. THE EXTENSION IS
// DERIVED HERE, never taken from a client-supplied filename: a filename is
// attacker-controlled text, and the only thing it could add is a way for the
// stored key to disagree with the type that was signed.
//
// An allowlist rather than a pattern. `audio/*` would accept formats the
// processor has no branch for, and the failure would surface as a FAILED asset
// after a queue round trip instead of a 400 at the boundary.
export const ACCEPTED_MEDIA_TYPES = {
  AUDIO: {
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
  },
  IMAGE: {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  },
} as const satisfies Record<MediaKind, Record<string, string>>;

// audio/webm is accepted alongside the three the API reference lists, because
// MediaRecorder in Chrome and Firefox produces it by default. Recording in the
// browser is the shortest path from a speaker to an asset, and refusing the
// format that path produces would push every contributor through a file
// manager.

// 10MB, matching the published reference. Not a content constraint — a
// single-word recording is orders of magnitude below it even uncompressed —
// but a bound on what one presigned URL can cost. It is signed as
// Content-Length, so S3 rejects a larger body rather than accepting it and
// leaving the API to notice afterwards.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// How many uploads one user may have outstanding — created by presign and
// never completed. A presigned URL is a write capability handed out on
// request, so something has to bound how many exist at once.
//
// A COUNT, NOT A RATE LIMIT, and deliberately not a substitute for one. The
// throttler on Redis (still unbuilt) limits request frequency; this limits how
// much unclaimed capability is outstanding, which is the part that survives a
// client retrying slowly. Abandoned rows are the reaper's input, so they do
// not accumulate forever and this ceiling is not a trap for an honest user who
// closed a tab.
export const MAX_UNRESOLVED_UPLOADS = 10;

// -----------------------------------------------------------------------------
// PRESIGN
// -----------------------------------------------------------------------------

// No `filename`. The reference spec carried one; it is dropped because nothing
// would read it — the extension comes from contentType, the object is
// identified by the asset id, and anything a contributor wants remembered
// about the recording belongs in `notes`, which is where the rest of the
// provenance lives.
export const PresignUploadSchema = z
  .object({
    kind: MediaKindSchema,
    contentType: z.string().min(1),
    sizeBytes: z.int().positive().max(MAX_UPLOAD_BYTES),
  })
  .refine((input) => input.contentType in ACCEPTED_MEDIA_TYPES[input.kind], {
    path: ['contentType'],
    message: 'Unsupported content type for this media kind',
  });
export type PresignUpload = z.infer<typeof PresignUploadSchema>;

// What comes back is a capability and an id, and NOT a URL the file will be
// readable at. Under ADR 20 no readable URL exists until an ADMIN approves the
// asset, so returning a predicted CDN address here — as the reference spec did
// — would hand out a link that is wrong until it is approved and misleading
// until it is processed.
//
// `headers` must be sent verbatim on the PUT. They are part of what was
// signed, so S3 refuses the upload if the body disagrees with them; that is
// what makes the declared type and size a constraint rather than a claim.
export const PresignedUploadSchema = z.object({
  assetId: z.string(),
  uploadUrl: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresInSeconds: z.int().positive(),
});
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;

// The asset as its owner sees it. No `sourceKey` and no `derivatives`: where
// the bytes live is internal, and a caller that needs to render media reads
// the URL on the entry or translation, which exists only once approved.
export const MediaAssetSchema = z.object({
  id: z.string(),
  kind: MediaKindSchema,
  status: MediaStatusSchema,
  contentType: z.string(),
  sizeBytes: z.int(),
  error: z.string().nullable(),
  notes: z.string().nullable(),
  isPublished: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

// -----------------------------------------------------------------------------
// ATTACHMENT
// -----------------------------------------------------------------------------

// The body of PUT /translations/:id/audio and PUT /entries/:id/image.
//
// NO expectedUpdatedAt, unlike every other write to these rows. Attaching does
// not modify the parent — it sets a foreign key and leaves `updatedAt` alone
// (docs/adr/0020) — so there is no version to contend for, and demanding one
// would make a recording fail because someone else fixed a typo. Two people
// attaching to the same row is settled by the unique constraint underneath,
// which is a race with one winner rather than a lost update.
export const AttachMediaSchema = z.object({
  assetId: z.string().min(1),
});
export type AttachMedia = z.infer<typeof AttachMediaSchema>;
