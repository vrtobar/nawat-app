'use client';

import { type Dialect, PartOfSpeechSchema } from '@nahuat/shared';

import { type TranslationDraft } from './translation-draft';

const labelClass = 'block text-xs font-medium uppercase tracking-wide text-gray-500';
const inputClass = 'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm';

// The field set for one translation, shared by the create form and the editor.
//
// Presentational and fully controlled: it owns no state and performs no saving,
// because the two callers save on different boundaries — the create form sends
// every card in one transaction, the editor saves each card on its own. Keeping
// the fields here and the saving there is what stops those two screens drifting
// into different ideas of what a translation is.
export function TranslationFields({
  draft,
  dialects,
  dialectLocked,
  disabled,
  onChange,
}: {
  draft: TranslationDraft;
  // Only the dialects this card may select — the caller excludes the ones its
  // siblings already hold, since a dialect is unique per entry.
  dialects: Dialect[];
  // True once the translation exists: UpdateTranslationSchema omits
  // dialectCode, so the API would silently ignore a change. Disabling the
  // select says so rather than accepting an edit that goes nowhere.
  dialectLocked: boolean;
  disabled: boolean;
  onChange: (next: TranslationDraft) => void;
}) {
  const set = <K extends keyof TranslationDraft>(key: K, value: TranslationDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor={`dialect-${draft.dialectCode}`}>
          Dialect
        </label>
        <select
          id={`dialect-${draft.dialectCode}`}
          className={inputClass}
          value={draft.dialectCode}
          disabled={disabled || dialectLocked}
          onChange={(event) => set('dialectCode', event.target.value)}
        >
          {dialects.map((dialect) => (
            <option key={dialect.code} value={dialect.code}>
              {dialect.nameEs}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor={`pos-${draft.dialectCode}`}>
          Part of speech
        </label>
        <select
          id={`pos-${draft.dialectCode}`}
          className={inputClass}
          value={draft.partOfSpeech}
          disabled={disabled}
          onChange={(event) =>
            set('partOfSpeech', event.target.value as TranslationDraft['partOfSpeech'])
          }
        >
          <option value="">—</option>
          {PartOfSpeechSchema.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {/* Spanish is the only required content. ADR 0015 §2 exempts dictionary
          entries from the English-to-publish rule, so the English field is a
          completeness hint and never a gate. */}
      <div>
        <label className={labelClass} htmlFor={`es-${draft.dialectCode}`}>
          Spanish *
        </label>
        <input
          id={`es-${draft.dialectCode}`}
          className={inputClass}
          value={draft.contentEs}
          disabled={disabled}
          onChange={(event) => set('contentEs', event.target.value)}
          placeholder="hombre | persona"
        />
        {/* Senses are pipe-separated within one translation rather than split
            across rows — a card prompts the whole word, so "takat → ?" would
            be ambiguous to grade if the senses lived apart. */}
        <p className="mt-1 text-xs text-gray-500">Separate senses with |</p>
      </div>

      <div>
        <label className={labelClass} htmlFor={`en-${draft.dialectCode}`}>
          English
        </label>
        <input
          id={`en-${draft.dialectCode}`}
          className={inputClass}
          value={draft.contentEn}
          disabled={disabled}
          onChange={(event) => set('contentEn', event.target.value)}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`phonetic-${draft.dialectCode}`}>
          Phonetic
        </label>
        <input
          id={`phonetic-${draft.dialectCode}`}
          className={inputClass}
          value={draft.phonetic}
          disabled={disabled}
          onChange={(event) => set('phonetic', event.target.value)}
        />
      </div>

      {/* No audio field. A URL box lived here while there was no upload flow;
          it is gone because `audioUrl` is now written by exactly one thing, an
          ADMIN approving a recording, and a box that PATCHes the column would
          be the approval gate defeated by typing. Attaching audio is the media
          sub-resource's job. */}

      {/* Not resolved to a locale on any read: Nawat is the subject, shown to
          every learner whichever language they study in. */}
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`ex-nawat-${draft.dialectCode}`}>
          Example (Nawat)
        </label>
        <input
          id={`ex-nawat-${draft.dialectCode}`}
          className={inputClass}
          value={draft.exampleNawat}
          disabled={disabled}
          onChange={(event) => set('exampleNawat', event.target.value)}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`ex-es-${draft.dialectCode}`}>
          Example (Spanish)
        </label>
        <input
          id={`ex-es-${draft.dialectCode}`}
          className={inputClass}
          value={draft.exampleEs}
          disabled={disabled}
          onChange={(event) => set('exampleEs', event.target.value)}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`ex-en-${draft.dialectCode}`}>
          Example (English)
        </label>
        <input
          id={`ex-en-${draft.dialectCode}`}
          className={inputClass}
          value={draft.exampleEn}
          disabled={disabled}
          onChange={(event) => set('exampleEn', event.target.value)}
        />
      </div>
    </div>
  );
}
