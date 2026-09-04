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
import {
  attachImageAction,
  createTranslationAction,
  detachImageAction,
  publishPendingTranslationsAction,
  updateEntryAction,
} from './actions';
import { MediaField } from './media-field';
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

  const [headerPending, startHeaderTransition] = useTransition();
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [headerSaved, setHeaderSaved] = useState(false);
  // Advanced on each successful save — see TranslationCard for why the card's
  // own second save would otherwise conflict with its first.
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(entry.updatedAt);

  const saveHeader = () =>
    startHeaderTransition(async () => {
      setHeaderError(null);
      const body: UpdateEntry = {
        expectedUpdatedAt,
        nawatContent: nawatContent.trim(),
        // Sent explicitly rather than omitted. `type` is unwrapped from its
        // default on the update schema, so an absent key genuinely leaves the
        // row alone — but the select always holds a value, so there is nothing
        // to be gained by leaving it out.
        type,
      };
      const result = await updateEntryAction(entry.id, body);
      if (result.ok) {
        setHeaderSaved(true);
        setExpectedUpdatedAt(result.updatedAt);
        return;
      }
      setHeaderError(result.message);
    });

  // A dialect is unique per entry, so only the unused ones can be added.
  const usedCodes = new Set(entry.translations.map((t) => t.dialect.code));
  const availableDialects = dialects.filter((dialect) => !usedCodes.has(dialect.code));

  // Translations added after the entry went live. They are drafts, and the
  // public reads exclude an unpublished translation in EVERY locale — so until
  // these are published the dialect exists only in the panel.
  const pending = entry.translations.filter((t) => !t.isPublished);
  const hasPending = entry.isPublished && pending.length > 0;

  const [publishPending, startPublishTransition] = useTransition();
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishTranslations = () =>
    startPublishTransition(async () => {
      setPublishError(null);
      const result = await publishPendingTranslationsAction(entry.id);
      if (!result.ok) setPublishError(result.message);
      // On success the cascade publishes them and the revalidated page renders
      // without this button, so there is no state to reset.
    });

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

          {/* No image field, for the reason given in translation-fields: the
              column is written only when an ADMIN approves a MediaAsset, so a
              URL box here would route around the gate. */}
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

        {/* Not gated on canEditEntry, which is the entry's rule. Media has its
            own: only media a reviewer already approved is admin-only to change,
            so a contributor may add an image to a published entry. */}
        <MediaField
          kind="IMAGE"
          noun="image"
          status={entry.imageStatus}
          url={entry.imageUrl}
          error={entry.imageError}
          savedNotes={entry.imageNotes}
          disabled={!isAdmin && entry.imageUrl !== null}
          attachAction={(assetId) => attachImageAction(entry.id, assetId)}
          detachAction={() => detachImageAction(entry.id)}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Translations</h2>

        {/* Only reachable from here. The list shows Unpublish for a live entry,
            so the publish cascade — the thing that would promote these — has no
            control anywhere else. Uses PATCH /entries/:id/publish unchanged:
            it is a no-op on an already-published entry and cascades to exactly
            its drafts. */}
        {hasPending && (
          <div className="flex items-center gap-3 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="flex-1 text-xs text-amber-800">
              {pending.length === 1
                ? '1 translation was added after this entry was published and is not live yet.'
                : `${pending.length} translations were added after this entry was published and are not live yet.`}{' '}
              They do not appear in the dictionary in any language.
            </p>
            {/* Information stays, the action goes. A contributor needs to know
                their dialect is not reaching readers, but publishing is ADMIN —
                so they get the sentence and not the button. Rendering it
                disabled instead would invite a click and explain nothing, and
                every other admin-only action in this panel is hidden rather
                than greyed. */}
            {isAdmin ? (
              <button
                type="button"
                disabled={publishPending}
                onClick={publishTranslations}
                className="rounded border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {publishPending ? 'Publishing…' : `Publish ${pending.length === 1 ? 'it' : 'them'}`}
              </button>
            ) : (
              <span className="whitespace-nowrap text-xs text-amber-800">
                An administrator can publish {pending.length === 1 ? 'it' : 'them'}.
              </span>
            )}
          </div>
        )}
        {publishError && <p className="text-xs text-red-700">{publishError}</p>}

        {/* Entry-level rather than per-card, because this is the case where the
            HEADWORD disappears rather than one sense of it. Publishing is still
            allowed with Spanish alone (ADR 0015 §2) — this states the cost,
            it does not block anything. */}
        {entry.translations.length > 0 && entry.translations.every((t) => t.contentEn === null) && (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            No translation has an English gloss, so this entry does not appear in the English
            dictionary at all. It publishes fine with Spanish alone — adding English anywhere below
            makes it visible.
          </p>
        )}

        {entry.translations.map((translation) => (
          <TranslationCard
            key={translation.id}
            entryId={entry.id}
            translation={translation}
            entryPublished={entry.isPublished}
            canEdit={isAdmin || !translation.isPublished}
            // ADMIN-only on the API, so the button is not offered otherwise.
            canDelete={isAdmin}
            isAdmin={isAdmin}
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
