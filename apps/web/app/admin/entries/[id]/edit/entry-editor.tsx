'use client';

import {
  type AdminEntryDetail,
  type Dialect,
  type EntryType,
  EntryTypeSchema,
  type UpdateEntry,
  type UserProfile,
} from '@nahuat/shared';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { blankDraft, toCreateTranslation, type TranslationDraft } from '../../translation-draft';
import { TranslationFields } from '../../translation-fields';
import { createTranslationAction, updateEntryAction } from './actions';
import { TranslationCard } from './translation-card';

const labelClass = 'block text-xs font-medium uppercase tracking-wide text-gray-500';
const inputClass = 'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm';

// The entry editor. Three independent save boundaries — the header, each
// translation, and adding a dialect — because those are the API's, not because
// a form was split for looks. See ./actions.ts.
export function EntryEditor({
  entry,
  dialects,
  me,
}: {
  entry: AdminEntryDetail;
  dialects: Dialect[];
  me: UserProfile;
}) {
  const isAdmin = me.role === 'ADMIN';
  // A CONTRIBUTOR may edit only drafts: the service refuses a published row
  // with publishedEditForbidden. Reflected here so the form does not offer a
  // save that is going to come back 403.
  const canEditEntry = isAdmin || !entry.isPublished;

  const [nawatContent, setNawatContent] = useState(entry.nawatContent);
  const [type, setType] = useState<EntryType>(entry.type);
  const [imageUrl, setImageUrl] = useState(entry.imageUrl ?? '');

  const [headerPending, startHeaderTransition] = useTransition();
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [headerSaved, setHeaderSaved] = useState(false);

  const saveHeader = () =>
    startHeaderTransition(async () => {
      setHeaderError(null);
      const trimmedImage = imageUrl.trim();
      const body: UpdateEntry = {
        nawatContent: nawatContent.trim(),
        // Sent explicitly rather than omitted. `type` is unwrapped from its
        // default on the update schema, so an absent key genuinely leaves the
        // row alone — but the select always holds a value, so there is nothing
        // to be gained by leaving it out.
        type,
        // null clears, '' would be rejected by z.url().
        imageUrl: trimmedImage === '' ? null : trimmedImage,
      };
      const result = await updateEntryAction(entry.id, body);
      if (result.ok) setHeaderSaved(true);
      else setHeaderError(result.message);
    });

  // A dialect is unique per entry, so only the unused ones can be added.
  const usedCodes = new Set(entry.translations.map((t) => t.dialect.code));
  const availableDialects = dialects.filter((dialect) => !usedCodes.has(dialect.code));

  const [addDraft, setAddDraft] = useState<TranslationDraft | null>(null);
  const [addPending, startAddTransition] = useTransition();
  const [addError, setAddError] = useState<string | null>(null);

  const addDialect = () => {
    if (!addDraft) return;
    startAddTransition(async () => {
      setAddError(null);
      const result = await createTranslationAction(entry.id, toCreateTranslation(addDraft));
      // Cleared on success so the revalidated list shows the new card instead
      // of a duplicate of it sitting in the add form.
      if (result.ok) setAddDraft(null);
      else setAddError(result.message);
    });
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Entry</h2>
          <span className="text-xs text-gray-500">
            {entry.isPublished ? 'Published' : 'Draft'} · last edited by {entry.updater.name}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="nawatContent">
              Headword (Nawat) *
            </label>
            <input
              id="nawatContent"
              className={inputClass}
              value={nawatContent}
              disabled={headerPending || !canEditEntry}
              onChange={(event) => {
                setNawatContent(event.target.value);
                setHeaderSaved(false);
              }}
            />
            {/* The slug is regenerated server-side when the headword changes,
                so renaming can collide with another entry's slug and come back
                as a conflict rather than silently succeeding. */}
            <p className="mt-1 text-xs text-gray-500">/{entry.slug}</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="type">
              Type
            </label>
            <select
              id="type"
              className={inputClass}
              value={type}
              disabled={headerPending || !canEditEntry}
              onChange={(event) => {
                setType(event.target.value as EntryType);
                setHeaderSaved(false);
              }}
            >
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
              disabled={headerPending || !canEditEntry}
              onChange={(event) => {
                setImageUrl(event.target.value);
                setHeaderSaved(false);
              }}
              placeholder="https://"
            />
            <p className="mt-1 text-xs text-gray-500">Clear the box to remove the image.</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={headerPending || !canEditEntry}
            onClick={saveHeader}
            className="rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {headerPending ? 'Saving…' : 'Save entry'}
          </button>
          {headerSaved && <span className="text-xs text-gray-500">Saved</span>}
          {headerError && <span className="text-xs text-red-700">{headerError}</span>}
          {!canEditEntry && (
            <span className="text-xs text-gray-500">
              Published — an administrator can edit this
            </span>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Translations</h2>

        {entry.translations.map((translation) => (
          <TranslationCard
            key={translation.id}
            entryId={entry.id}
            translation={translation}
            canEdit={isAdmin || !translation.isPublished}
            // ADMIN-only on the API, so the button is not offered otherwise.
            canDelete={isAdmin}
          />
        ))}
      </section>

      <section className="space-y-3">
        {addDraft === null ? (
          <button
            type="button"
            disabled={availableDialects.length === 0 || !canEditEntry}
            onClick={() => {
              const first = availableDialects[0];
              if (first) setAddDraft(blankDraft(first.code));
            }}
            className="rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {availableDialects.length === 0 ? 'Every dialect has a translation' : 'Add dialect'}
          </button>
        ) : (
          <div className="rounded border border-dashed border-gray-300 p-4">
            <h3 className="mb-3 text-sm font-semibold">New translation</h3>
            <TranslationFields
              draft={addDraft}
              dialects={availableDialects}
              // Unlocked here and only here: a dialect is chosen at creation
              // and immutable afterwards.
              dialectLocked={false}
              disabled={addPending}
              onChange={setAddDraft}
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                disabled={addPending}
                onClick={addDialect}
                className="rounded bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {addPending ? 'Adding…' : 'Add translation'}
              </button>
              <button
                type="button"
                disabled={addPending}
                onClick={() => {
                  setAddDraft(null);
                  setAddError(null);
                }}
                className="text-sm text-gray-600 hover:underline disabled:opacity-50"
              >
                Cancel
              </button>
              {addError && <span className="text-xs text-red-700">{addError}</span>}
            </div>
          </div>
        )}
      </section>

      <Link href="/admin/entries" className="inline-block text-sm text-gray-600 hover:underline">
        Back to drafts
      </Link>
    </div>
  );
}
