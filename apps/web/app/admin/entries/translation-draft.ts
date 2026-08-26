import {
  type AdminTranslationDetail,
  type CreateTranslation,
  type PartOfSpeech,
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
  audioUrl: string;
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
    audioUrl: '',
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
    audioUrl: t.audioUrl ?? '',
  };
}

// An untouched optional field is omitted, not sent as an empty string. Both
// halves of that matter:
//
//   - `contentEn` is z.string().optional(), so '' passes validation and would
//     be STORED. `hasEnglish` counts a non-null contentEn as English present,
//     so a blank field would report an entry as complete while carrying no
//     English at all.
//   - `audioUrl` is z.url(), which REJECTS '', so an untouched audio box would
//     fail validation on a form the author never typed into.
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
    audioUrl: omitEmpty(draft.audioUrl),
  };
}
