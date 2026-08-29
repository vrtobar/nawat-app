import {
  type AdminTranslationDetail,
  type CreateTranslation,
  type PartOfSpeech,
  type UpdateTranslation,
} from '@nahuat/shared';

// One translation as the form holds it: every field a string, including the
// ones the DTO types as optional. That is what an <input> stores, and the
// distinction the DTO cares about — absent versus present — has no
// representation in a text box.
//
// So the conversion happens once, on submit, in this file rather than at each
// call site. `partOfSpeech` is the exception that keeps its union: the select
// offers only valid values, so typing it as PartOfSpeech | '' avoids a cast
// that would let an invalid string through unnoticed.
export type TranslationDraft = {
  dialectCode: string;
  contentEs: string;
  contentEn: string;
  phonetic: string;
  partOfSpeech: PartOfSpeech | '';
  exampleNawat: string;
  exampleEs: string;
  exampleEn: string;
};

export function blankDraft(dialectCode: string): TranslationDraft {
  return {
    dialectCode,
    contentEs: '',
    contentEn: '',
    phonetic: '',
    partOfSpeech: '',
    exampleNawat: '',
    exampleEs: '',
    exampleEn: '',
  };
}

// Prefills the form from the admin read shape. No field renaming happens here,
// and that is the point of AdminTranslationDetail existing: its field names are
// CreateTranslationSchema's, so this is a null-to-empty-string conversion and
// nothing else. A rename would have to pass through here to be wrong.
export function draftFrom(t: AdminTranslationDetail): TranslationDraft {
  return {
    dialectCode: t.dialect.code,
    contentEs: t.contentEs,
    contentEn: t.contentEn ?? '',
    phonetic: t.phonetic ?? '',
    partOfSpeech: t.partOfSpeech ?? '',
    exampleNawat: t.exampleNawat ?? '',
    exampleEs: t.exampleEs ?? '',
    exampleEn: t.exampleEn ?? '',
  };
}

// An untouched optional field is omitted, not sent as an empty string. Both
// halves of that matter:
//
//   - `contentEn` is z.string().optional(), so '' passes validation and would
//     be STORED. `hasEnglish` counts a non-null contentEn as English present,
//     so a blank field would report an entry as complete while carrying no
//     English at all.
//   - The same trap applied to `audioUrl`, a z.url() that REJECTS '', until
//     audio stopped being a form field at all — it is attached through the
//     media sub-resource now, so no URL box can be left untouched.
//
// Trimmed on the way through: a field holding only spaces is an untouched
// field that was tabbed across.
function omitEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function toCreateTranslation(draft: TranslationDraft): CreateTranslation {
  return {
    dialectCode: draft.dialectCode,
    // Required by the schema, so it is trimmed but never omitted — an empty
    // one is a validation error the form surfaces, not a field to drop.
    contentEs: draft.contentEs.trim(),
    contentEn: omitEmpty(draft.contentEn),
    phonetic: omitEmpty(draft.phonetic),
    partOfSpeech: draft.partOfSpeech === '' ? undefined : draft.partOfSpeech,
    exampleNawat: omitEmpty(draft.exampleNawat),
    exampleEs: omitEmpty(draft.exampleEs),
    exampleEn: omitEmpty(draft.exampleEn),
  };
}

// An empty field on UPDATE is a CLEAR, and this is the deliberate inverse of
// omitEmpty above rather than an inconsistency.
//
// On create, an empty box means the field never had a value, so omitting it is
// exactly right. On update it means the author emptied a box that had something
// in it, and only an explicit null says so — `undefined` disappears in
// JSON.stringify, so an omitted key reaches the server as no key at all and the
// column keeps whatever it held. That is why UpdateTranslationSchema is
// nullable where CreateTranslationSchema is merely optional.
//
// Sent unconditionally rather than diffed against what was loaded: nulling a
// column that is already null is a no-op, and a diff would introduce a second
// account of what changed for no behavioural gain.
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// dialectCode is absent because a dialect is immutable after creation — the
// schema omits it, so sending one would be ignored.
//
// `expectedUpdatedAt` is passed in rather than carried on the draft: the draft
// is form state, and this is not something the author edits. Keeping it out
// also makes it obvious at the call site that the value must be the one most
// recently seen from the server, not the one the form was first built from.
export function toUpdateTranslation(
  draft: TranslationDraft,
  expectedUpdatedAt: string,
): UpdateTranslation {
  return {
    expectedUpdatedAt,
    // The one field with no null branch: a translation with no Spanish gloss
    // renders nowhere, so it is replaced or left alone, never emptied.
    contentEs: draft.contentEs.trim(),
    contentEn: emptyToNull(draft.contentEn),
    phonetic: emptyToNull(draft.phonetic),
    partOfSpeech: draft.partOfSpeech === '' ? null : draft.partOfSpeech,
    exampleNawat: emptyToNull(draft.exampleNawat),
    exampleEs: emptyToNull(draft.exampleEs),
    exampleEn: emptyToNull(draft.exampleEn),
  };
}
