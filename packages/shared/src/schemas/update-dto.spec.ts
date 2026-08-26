import { describe, expect, it } from 'vitest';

import { CreateEntrySchema, UpdateEntrySchema } from './entry.schema';
import { UpdateTranslationSchema } from './translation.schema';

// The update DTOs carry a distinction the create ones do not: an absent key
// means "leave this alone" and an explicit null means "clear it" (RFC 7396).
// Both halves are load-bearing and neither is visible in the type alone, so
// they are pinned here.
describe('UpdateTranslationSchema', () => {
  it('clears an optional field when it is sent as null', () => {
    expect(UpdateTranslationSchema.parse({ contentEn: null })).toEqual({ contentEn: null });
  });

  it('leaves a field alone when the key is absent', () => {
    // The distinction that matters on the wire: JSON.stringify drops an
    // undefined value entirely, so an omitted key is the only way a client can
    // say "do not touch this".
    expect(UpdateTranslationSchema.parse({})).toEqual({});
  });

  it('still rejects an empty string for a URL field', () => {
    // Clearing is null, never ''. An untouched audio box must be omitted or
    // nulled — z.url() rejects the empty string, which is what stops a blank
    // field from being mistaken for a cleared one.
    expect(UpdateTranslationSchema.safeParse({ audioUrl: '' }).success).toBe(false);
  });

  it('accepts null for partOfSpeech but still rejects an unknown member', () => {
    expect(UpdateTranslationSchema.parse({ partOfSpeech: null })).toEqual({ partOfSpeech: null });
    expect(UpdateTranslationSchema.safeParse({ partOfSpeech: 'NOPE' }).success).toBe(false);
  });

  it('refuses to null contentEs, the one field a translation cannot lose', () => {
    // A row with no Spanish gloss renders nowhere, so it can be replaced but
    // never emptied.
    expect(UpdateTranslationSchema.safeParse({ contentEs: null }).success).toBe(false);
    expect(UpdateTranslationSchema.safeParse({ contentEs: '' }).success).toBe(false);
  });

  it('drops dialectCode, which is immutable after creation', () => {
    expect(UpdateTranslationSchema.parse({ dialectCode: 'izalco' })).toEqual({});
  });
});

describe('UpdateEntrySchema', () => {
  it('does not inject the type default into a partial update', () => {
    // REGRESSION. UpdateEntrySchema was CreateEntrySchema.partial(), and
    // .partial() makes a field optional without removing the .default()
    // underneath it — so a rename resolved type to 'WORD' and the service
    // spread it into the row, silently turning an EXPRESSION or a PHRASE into
    // a WORD. Renaming must change the headword and nothing else.
    expect(UpdateEntrySchema.parse({ nawatContent: 'takat' })).toEqual({
      nawatContent: 'takat',
    });
  });

  it('still applies the type default on create, where it belongs', () => {
    expect(CreateEntrySchema.parse({ nawatContent: 'takat' })).toEqual({
      nawatContent: 'takat',
      type: 'WORD',
    });
  });

  it('still validates type when one is supplied', () => {
    expect(UpdateEntrySchema.parse({ type: 'PHRASE' })).toEqual({ type: 'PHRASE' });
    expect(UpdateEntrySchema.safeParse({ type: 'NOPE' }).success).toBe(false);
  });

  it('clears imageUrl when sent as null, but refuses to null the headword', () => {
    expect(UpdateEntrySchema.parse({ imageUrl: null })).toEqual({ imageUrl: null });
    expect(UpdateEntrySchema.safeParse({ nawatContent: null }).success).toBe(false);
  });
});
