'use server';

import { type CreateTranslation, type UpdateEntry, type UpdateTranslation } from '@nahuat/shared';
import { revalidatePath } from 'next/cache';

import {
  createTranslation,
  deleteTranslation,
  publishEntry,
  updateEntry,
  updateTranslation,
} from '../../../../../lib/api/admin';
import { ApiError } from '../../../../../lib/api/client';

// `updatedAt` comes back on success because the form holds it as its optimistic
// lock and must advance it, or its own next save conflicts with itself.
// `conflict` is separated from the message because the panel treats it
// differently: an ordinary failure is a message, a conflict is an offer to
// reload without discarding what the author typed.
export type SaveResult =
  { ok: true; updatedAt: string } | { ok: false; message: string; conflict: boolean };

// The API answers a stale precondition with EDIT_CONFLICT. Read off the code
// rather than the status, since 409 also covers uniqueness collisions, which
// reloading would not fix.
function toFailure(error: unknown, fallback: string): SaveResult {
  const conflict = error instanceof ApiError && error.code === 'EDIT_CONFLICT';
  return {
    ok: false,
    conflict,
    message: error instanceof Error ? error.message : fallback,
  };
}

// The editor's writes, one action per API call.
//
// FOUR ACTIONS RATHER THAN ONE SAVE, because there is no whole-entry update to
// save against: the headword, each translation, an added dialect and a removal
// are four different endpoints with four different transactions. A single Save
// fanning out across them would turn a partial failure into something this
// layer has to describe — "the headword saved but the Izalco gloss did not" —
// and that explanation is exactly where a seam bug hides. Saving per section
// means every save is one request that either happened or did not.
//
// All of them return a result rather than throwing, for the reason publishing
// does: a validation failure or a 403 on published content is an ordinary
// outcome of editing, and the error boundary is a disproportionate answer.

// Revalidates the editor and the queue it was opened from. The queue matters
// because these edits move rows within it: `translationCount` and `hasEnglish`
// are computed per row, so a saved gloss changes the list as well as the form.
function revalidateEntry(id: string) {
  revalidatePath(`/admin/entries/${id}/edit`);
  revalidatePath('/admin/entries');
}

export async function updateEntryAction(id: string, body: UpdateEntry): Promise<SaveResult> {
  let updated;
  try {
    updated = await updateEntry(id, body);
  } catch (error) {
    return toFailure(error, 'Could not save');
  }
  // `mutate` is typed nullable because several write routes answer with
  // `data: null`. These pass a schema, so a null here would mean the API
  // returned a success envelope with no body — checked rather than asserted,
  // since an assertion would surface as a crash in the panel instead.
  if (!updated) return { ok: false, conflict: false, message: 'The save returned no entry' };

  revalidateEntry(id);
  return { ok: true, updatedAt: updated.updatedAt };
}

export async function updateTranslationAction(
  entryId: string,
  translationId: string,
  body: UpdateTranslation,
): Promise<SaveResult> {
  let updated;
  try {
    updated = await updateTranslation(translationId, body);
  } catch (error) {
    return toFailure(error, 'Could not save');
  }
  if (!updated) {
    return { ok: false, conflict: false, message: 'The save returned no translation' };
  }

  revalidateEntry(entryId);
  return { ok: true, updatedAt: updated.updatedAt };
}

// Creation and removal carry no optimistic lock: a create has no prior version
// to be stale against (a repeated dialect collides on the unique constraint
// instead), and a delete is idempotent in effect — removing a row someone else
// already removed is the outcome the caller wanted.
export type ActionResult = { ok: true } | { ok: false; message: string };

export async function createTranslationAction(
  entryId: string,
  body: CreateTranslation,
): Promise<ActionResult> {
  try {
    await createTranslation(entryId, body);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not add the dialect',
    };
  }
  revalidateEntry(entryId);
  return { ok: true };
}

export async function deleteTranslationAction(
  entryId: string,
  translationId: string,
): Promise<ActionResult> {
  try {
    await deleteTranslation(translationId);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not remove' };
  }
  revalidateEntry(entryId);
  return { ok: true };
}

// Publishes the translations added since the entry went live.
//
// WHY THIS ACTION EXISTS AT ALL. A translation is created as a draft, and
// publishing is entry-level and cascades — so a dialect added to an ALREADY
// PUBLISHED entry is stranded: the list offers Unpublish (the entry is live),
// which means the cascade that would publish it is unreachable, and the public
// reads exclude an unpublished translation in every locale. The only path was
// unpublishing the whole entry and publishing it again, taking the headword off
// the dictionary in between.
//
// No new endpoint. PATCH /entries/:id/publish already sets the entry published
// — a no-op when it already is — and cascades to exactly its draft
// translations, which is precisely the operation wanted here. It is named for
// what it does from the editor rather than reusing publishEntryAction, whose
// revalidation targets only the list.
export async function publishPendingTranslationsAction(entryId: string): Promise<ActionResult> {
  try {
    await publishEntry(entryId);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not publish',
    };
  }
  revalidateEntry(entryId);
  return { ok: true };
}
