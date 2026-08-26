import { describe, expect, it } from 'vitest';

import { CreateEntrySchema, UpdateEntrySchema } from './entry.schema';
import { UpdateTranslationSchema } from './translation.schema';

// Every update DTO carries the optimistic lock, and it is REQUIRED. These tests
// are about the other fields, so it is supplied on the way in and dropped on
// the way out — and supplying it matters even in the cases that expect
// rejection, or they would pass on a missing lock rather than on the thing
// under test.
const AT = '2026-08-24T00:00:00.000Z';

const parseUpdate = <T extends { parse: (v: unknown) => Record<string, unknown> }>(
  schema: T,
  input: Record<string, unknown>,
) => {
  const { expectedUpdatedAt: _lock, ...rest } = schema.parse({ ...input, expectedUpdatedAt: AT });
  return rest;
};

const safeUpdate = <T extends { safeParse: (v: unknown) => { success: boolean } }>(
  schema: T,
  input: Record<string, unknown>,
) => schema.safeParse({ ...input, expectedUpdatedAt: AT });

// The update DTOs carry a distinction the create ones do not: an absent key
// means "leave this alone" and an explicit null means "clear it" (RFC 7396).
// Both halves are load-bearing and neither is visible in the type alone, so
// they are pinned here.
describe('UpdateTranslationSchema', () => {
  it('clears an optional field when it is sent as null', () => {
    expect(parseUpdate(UpdateTranslationSchema, { contentEn: null })).toEqual({ contentEn: null });
  });

  it('leaves a field alone when the key is absent', () => {
    // The distinction that matters on the wire: JSON.stringify drops an
    // undefined value entirely, so an omitted key is the only way a client can
    // say "do not touch this".
    expect(parseUpdate(UpdateTranslationSchema, {})).toEqual({});
  });

  it('still rejects an empty string for a URL field', () => {
    // Clearing is null, never ''. An untouched audio box must be omitted or
    // nulled — z.url() rejects the empty string, which is what stops a blank
    // field from being mistaken for a cleared one.
    expect(safeUpdate(UpdateTranslationSchema, { audioUrl: '' }).success).toBe(false);
  });

  it('accepts null for partOfSpeech but still rejects an unknown member', () => {
    expect(parseUpdate(UpdateTranslationSchema, { partOfSpeech: null })).toEqual({
      partOfSpeech: null,
    });
    expect(safeUpdate(UpdateTranslationSchema, { partOfSpeech: 'NOPE' }).success).toBe(false);
  });

  it('refuses to null contentEs, the one field a translation cannot lose', () => {
    // A row with no Spanish gloss renders nowhere, so it can be replaced but
    // never emptied.
    expect(safeUpdate(UpdateTranslationSchema, { contentEs: null }).success).toBe(false);
    expect(safeUpdate(UpdateTranslationSchema, { contentEs: '' }).success).toBe(false);
  });

  it('drops dialectCode, which is immutable after creation', () => {
    expect(parseUpdate(UpdateTranslationSchema, { dialectCode: 'izalco' })).toEqual({});
  });
});

describe('UpdateEntrySchema', () => {
  it('does not inject the type default into a partial update', () => {
    // REGRESSION. UpdateEntrySchema was CreateEntrySchema.partial(), and
    // .partial() makes a field optional without removing the .default()
    // underneath it — so a rename resolved type to 'WORD' and the service
    // spread it into the row, silently turning an EXPRESSION or a PHRASE into
    // a WORD. Renaming must change the headword and nothing else.
    expect(parseUpdate(UpdateEntrySchema, { nawatContent: 'takat' })).toEqual({
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
    expect(parseUpdate(UpdateEntrySchema, { type: 'PHRASE' })).toEqual({ type: 'PHRASE' });
    expect(safeUpdate(UpdateEntrySchema, { type: 'NOPE' }).success).toBe(false);
  });

  it('clears imageUrl when sent as null, but refuses to null the headword', () => {
    expect(parseUpdate(UpdateEntrySchema, { imageUrl: null })).toEqual({ imageUrl: null });
    expect(safeUpdate(UpdateEntrySchema, { nawatContent: null }).success).toBe(false);
  });
});

describe('the optimistic lock', () => {
  it('is required on both update DTOs', () => {
    // A precondition a client may omit defaults to off, which is the behaviour
    // it exists to prevent — so its absence is a validation error, not a
    // silently unguarded write.
    expect(UpdateTranslationSchema.safeParse({ contentEn: 'man' }).success).toBe(false);
    expect(UpdateEntrySchema.safeParse({ nawatContent: 'takat' }).success).toBe(false);
  });

  it('rejects anything that is not an ISO datetime', () => {
    expect(safeUpdate(UpdateEntrySchema, {}).success).toBe(true);
    expect(UpdateEntrySchema.safeParse({ expectedUpdatedAt: 'yesterday' }).success).toBe(false);
    expect(UpdateEntrySchema.safeParse({ expectedUpdatedAt: 1756070400000 }).success).toBe(false);
  });
});
