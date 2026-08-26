'use client';

import { type AdminTranslationDetail } from '@nahuat/shared';
import { useState, useTransition } from 'react';

import { draftFrom, toUpdateTranslation, type TranslationDraft } from '../../translation-draft';
import { TranslationFields } from '../../translation-fields';
import { deleteTranslationAction, updateTranslationAction } from './actions';

// One existing translation, saving on its own.
//
// Its own state and its own request: the card is the transaction boundary the
// API actually has (PATCH /translations/:id), so it is the boundary the UI
// shows. Nothing here knows about its siblings.
export function TranslationCard({
  entryId,
  translation,
  canEdit,
  canDelete,
}: {
  entryId: string;
  translation: AdminTranslationDetail;
  // False for a CONTRIBUTOR looking at published content: both
  // entries.service.update and translations.service.update refuse it with
  // publishedEditForbidden, so the fields are disabled rather than offering a
  // Save that is going to 403.
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [draft, setDraft] = useState<TranslationDraft>(() => draftFrom(translation));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const change = (next: TranslationDraft) => {
    setDraft(next);
    setSaved(false);
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await updateTranslationAction(
        entryId,
        translation.id,
        toUpdateTranslation(draft),
      );
      if (result.ok) setSaved(true);
      else setError(result.message);
    });

  const remove = () =>
    startTransition(async () => {
      setError(null);
      const result = await deleteTranslationAction(entryId, translation.id);
      if (!result.ok) {
        setError(result.message);
        setConfirmingRemove(false);
      }
      // On success the card disappears with the revalidated list, so there is
      // no state to reset here.
    });

  return (
    <div className="rounded border border-gray-200 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">{translation.dialect.nameEs}</h3>
          {/* Publication is entry-level and cascades, but a dialect added after
              the entry went live is a draft on a published entry — so this is
              per translation rather than inherited from the header. */}
          <span className="text-xs text-gray-500">
            {translation.isPublished ? 'Published' : 'Draft'}
          </span>
        </div>

        {canDelete &&
          (confirmingRemove ? (
            <span className="flex items-center gap-2 text-xs">
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className="font-medium text-red-700 hover:underline disabled:opacity-50"
              >
                {pending ? 'Removing…' : 'Confirm remove'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmingRemove(false)}
                className="text-gray-500 hover:underline disabled:opacity-50"
              >
                Cancel
              </button>
            </span>
          ) : (
            // Two clicks, because a published translation is soft-deleted and a
            // draft is removed outright — neither is undoable from this screen.
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmingRemove(true)}
              className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-40"
            >
              Remove
            </button>
          ))}
      </div>

      <TranslationFields
        draft={draft}
        // Only its own dialect: the select is locked, so there is nothing else
        // to offer.
        dialects={[translation.dialect]}
        dialectLocked
        disabled={pending || !canEdit}
        onChange={change}
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !canEdit}
          onClick={save}
          className="rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-gray-500">Saved</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
        {!canEdit && (
          <span className="text-xs text-gray-500">Published — an administrator can edit this</span>
        )}
      </div>
    </div>
  );
}
