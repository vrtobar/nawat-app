'use client';

import {
  CreateFullEntrySchema,
  DEFAULT_DIALECT_CODE,
  type Dialect,
  type EntryType,
  EntryTypeSchema,
} from '@nahuat/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { blankDraft, toCreateTranslation, type TranslationDraft } from '../translation-draft';
import { TranslationFields } from '../translation-fields';
import { createEntryAction } from './actions';

const labelClass = 'block text-xs font-medium uppercase tracking-wide text-gray-500';
const inputClass = 'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm';

// Creating an entry and its translations in one transaction.
//
// SEVERAL DIALECTS AT ONCE, deliberately. POST /entries/full takes an array, so
// seeding a word in every dialect it is attested in costs one request; letting
// the form send only one would mean creating, reopening and editing to add the
// second, for no gain anywhere.
//
// One Save, unlike the editor, and the difference is not a style choice: this
// endpoint is genuinely atomic, so a single button matches what the API does.
// Editing has no whole-entry write and saves per section for the same reason.
export function NewEntryForm({ dialects }: { dialects: Dialect[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [nawatContent, setNawatContent] = useState('');
  const [type, setType] = useState<EntryType>('WORD');
  const [imageUrl, setImageUrl] = useState('');

  // Opens on the broadly-used form rather than a town's, matching how the
  // reads pick a headword. Falls back to the first dialect if the reference
  // data has no `common` row.
  const [drafts, setDrafts] = useState<TranslationDraft[]>(() => [
    blankDraft(
      dialects.find((d) => d.code === DEFAULT_DIALECT_CODE)?.code ?? dialects[0]?.code ?? '',
    ),
  ]);

  // A dialect has at most one translation per entry, so a code held by another
  // card is not offered here — picking it twice would collide on the unique
  // constraint and surface as a P2002 the form could not explain.
  const availableFor = (index: number) => {
    const takenElsewhere = new Set(
      drafts.filter((_, i) => i !== index).map((draft) => draft.dialectCode),
    );
    return dialects.filter((dialect) => !takenElsewhere.has(dialect.code));
  };

  const unusedDialect = dialects.find(
    (dialect) => !drafts.some((draft) => draft.dialectCode === dialect.code),
  );

  const submit = () => {
    setError(null);

    const payload = {
      nawatContent: nawatContent.trim(),
      type,
      imageUrl: imageUrl.trim() === '' ? undefined : imageUrl.trim(),
      translations: drafts.map(toCreateTranslation),
    };

    // Validated against the same schema the API validates with, so the form
    // catches what the request would have been rejected for. This is a
    // convenience, never the boundary — the API revalidates regardless.
    const parsed = CreateFullEntrySchema.safeParse(payload);
    if (!parsed.success) {
      // First issue only. The form is short enough that fixing them one at a
      // time is not a burden, and a concatenated list reads worse than the one
      // thing to correct next.
      const [issue] = parsed.error.issues;
      const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      setError(issue ? `${where}${issue.message}` : 'The entry is not valid');
      return;
    }

    startTransition(async () => {
      const result = await createEntryAction(parsed.data);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // To the queue rather than to the new row's editor: the draft list is
      // where the next thing to do is, and the row is now the first line of it.
      router.push('/admin/entries');
    });
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="nawatContent">
            Headword (Nawat) *
          </label>
          <input
            id="nawatContent"
            className={inputClass}
            value={nawatContent}
            disabled={pending}
            onChange={(event) => setNawatContent(event.target.value)}
          />
          {/* The URL identifier is derived server-side (ADR 0016), so there is
              no slug field to fill in or keep in sync with the headword. */}
        </div>

        <div>
          <label className={labelClass} htmlFor="type">
            Type
          </label>
          <select
            id="type"
            className={inputClass}
            value={type}
            disabled={pending}
            onChange={(event) => setType(event.target.value as EntryType)}
          >
            {/* PHRASE is offered even though the public dictionary excludes it:
                it is lesson content, and hiding it from the surface that
                manages it is how content becomes unreachable. */}
            {EntryTypeSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="imageUrl">
            Image URL
          </label>
          <input
            id="imageUrl"
            className={inputClass}
            value={imageUrl}
            disabled={pending}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://"
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Translations</h2>
          <button
            type="button"
            disabled={pending || unusedDialect === undefined}
            onClick={() => unusedDialect && setDrafts([...drafts, blankDraft(unusedDialect.code)])}
            className="rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Add dialect
          </button>
        </div>

        {drafts.map((draft, index) => (
          <div key={draft.dialectCode} className="rounded border border-gray-200 p-4">
            <div className="mb-3 flex justify-end">
              {/* The schema requires at least one translation, so the last card
                  cannot be removed — a full create with none is just POST
                  /entries, which this form does not use. */}
              <button
                type="button"
                disabled={pending || drafts.length === 1}
                onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
                className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
            <TranslationFields
              draft={draft}
              dialects={availableFor(index)}
              dialectLocked={false}
              disabled={pending}
              onChange={(next) => setDrafts(drafts.map((d, i) => (i === index ? next : d)))}
            />
          </div>
        ))}
      </section>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create entry'}
        </button>
        <Link href="/admin/entries" className="text-sm text-gray-600 hover:underline">
          Cancel
        </Link>
      </div>
    </div>
  );
}
