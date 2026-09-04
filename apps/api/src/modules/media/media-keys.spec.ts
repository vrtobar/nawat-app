import { PresignUploadSchema } from '@nahuat/shared';
import { describe, expect, it } from 'vitest';

import { extensionFor, sourceKeyFor } from './media-keys';

// The allowlist and the extension table are ONE map, read by two halves of the
// upload path: PresignUploadSchema decides what may be uploaded, and
// extensionFor decides what the stored object is called. A format present in
// one and absent from the other is not expressible — which is the property
// worth pinning, because it is what makes "add a format" a one-line change.

describe('accepted audio formats', () => {
  const presign = (contentType: string) =>
    PresignUploadSchema.safeParse({ kind: 'AUDIO', contentType, sizeBytes: 2048 });

  // "At worst a capable phone" is the fallback capture path this project
  // documents, and iOS Voice Memos exports .m4a. It was refused at presign, so
  // the one recording device somebody always has produced files the
  // application would not take.
  it.each(['audio/mp4', 'audio/x-m4a'])('accepts %s, which is what a phone records', (type) => {
    expect(presign(type).success).toBe(true);
  });

  // Browsers disagree about which of the two an .m4a file is. Both must land on
  // the same extension, or the same recording would be stored under two names
  // depending on which browser sent it.
  it('stores both spellings of m4a under one extension', () => {
    expect(extensionFor('AUDIO', 'audio/mp4')).toBe('m4a');
    expect(extensionFor('AUDIO', 'audio/x-m4a')).toBe('m4a');
  });

  it('names the source object from the signed type, not from any filename', () => {
    expect(sourceKeyFor('med_1', 'AUDIO', 'audio/mp4')).toBe('source/med_1/source.m4a');
  });

  it('still refuses a format the processor has no branch for', () => {
    // An allowlist rather than a pattern: `audio/*` would accept formats that
    // fail after a queue round trip instead of at the boundary.
    expect(presign('audio/aiff').success).toBe(false);
  });

  // The two halves cannot disagree, because they read the same table. Asserted
  // rather than assumed: it is the reason adding a format is one line.
  it('accepts exactly the types it can name an extension for', () => {
    for (const type of ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4']) {
      expect(presign(type).success).toBe(true);
      expect(() => extensionFor('AUDIO', type)).not.toThrow();
    }
  });
});
