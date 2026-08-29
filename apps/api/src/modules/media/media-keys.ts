import { ACCEPTED_MEDIA_TYPES, type MediaKind } from '@nahuat/shared';

// THE THREE PREFIXES ARE A SECURITY BOUNDARY, NOT A FILING CONVENTION
// (docs/adr/0020). CloudFront's origin path covers `public/` alone, so an
// object outside it is unreachable through the CDN whatever its key — which is
// what makes an unapproved recording unreachable rather than merely unlinked.
//
// Keeping everything in one prefix and relying on unguessable keys was
// rejected: that makes the approval gate a convention that holds only while
// nobody shares a URL.
export const MEDIA_PREFIX = {
  // The original upload. Never served, never moved, kept permanently —
  // derivatives can be regenerated, a recording of one of roughly a hundred
  // speakers cannot.
  source: 'source',
  // Processed derivatives awaiting review.
  pending: 'pending',
  // Approved. The only prefix CloudFront can read.
  public: 'public',
} as const;

// Keyed on the asset id rather than the reference spec's
// `{userId}/{timestamp}_{nanoid}`. The row is the identity, so nothing has to
// be parsed back out of a key — and it keeps the uploader's user id out of an
// address that is eventually public.
export function sourceKeyFor(assetId: string, kind: MediaKind, contentType: string): string {
  const extension = extensionFor(kind, contentType);
  return `${MEDIA_PREFIX.source}/${assetId}/source.${extension}`;
}

// Derived from the signed content type, never from a client-supplied filename.
// Callers must validate the type first — PresignUploadSchema does, so a value
// reaching here that is not in the table is a programming error rather than
// bad input, and throwing beats writing an object with a misleading extension.
export function extensionFor(kind: MediaKind, contentType: string): string {
  const table: Record<string, string> = ACCEPTED_MEDIA_TYPES[kind];
  const extension = table[contentType];
  if (!extension) {
    throw new Error(`No extension mapped for ${kind} content type "${contentType}"`);
  }
  return extension;
}

// A derivative's key under a given prefix. The stored key is RELATIVE to the
// asset's folder, so publication is this function called twice with different
// prefixes — nothing is parsed, and the pending and public objects are
// guaranteed to differ in exactly one path component.
export function derivativeKey(
  prefix: (typeof MEDIA_PREFIX)[keyof typeof MEDIA_PREFIX],
  assetId: string,
  relativeKey: string,
): string {
  return `${prefix}/${assetId}/${relativeKey}`;
}

// The address a published derivative is served at.
//
// ⚠️ THE `public/` PREFIX IS ABSENT ON PURPOSE. The CloudFront distribution
// sets `origin_path = "/public"`, so it prepends that component itself; a URL
// including it would resolve to `public/public/...` and 404. The prefix is how
// the bucket is organised and the origin path is how that organisation is
// hidden from viewers — this function is where the two meet, and it is the
// only place that knows.
export function cdnUrlFor(cdnBaseUrl: string, assetId: string, relativeKey: string): string {
  return `${cdnBaseUrl.replace(/\/$/, '')}/${assetId}/${relativeKey}`;
}
