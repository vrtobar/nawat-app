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

export type SaveResult = { ok: true } | { ok: false; message: string };

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
  try {
    await updateEntry(id, body);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save' };
  }
  revalidateEntry(id);
  return { ok: true };
}

export async function updateTranslationAction(
  entryId: string,
  translationId: string,
  body: UpdateTranslation,
): Promise<SaveResult> {
  try {
    await updateTranslation(translationId, body);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save' };
  }
  revalidateEntry(entryId);
  return { ok: true };
}

export async function createTranslationAction(
  entryId: string,
  body: CreateTranslation,
): Promise<SaveResult> {
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
): Promise<SaveResult> {
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
export async function publishPendingTranslationsAction(entryId: string): Promise<SaveResult> {
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
