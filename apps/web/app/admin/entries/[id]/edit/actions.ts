'use server';

import {
  type CreateTranslation,
  type MediaStatus,
  type PresignUpload,
  type UpdateEntry,
  type UpdateTranslation,
} from '@nahuat/shared';
import { revalidatePath } from 'next/cache';

import {
  createTranslation,
  deleteTranslation,
  publishEntry,
  updateEntry,
  updateTranslation,
} from '../../../../../lib/api/admin';
import { ApiError } from '../../../../../lib/api/client';
import {
  attachAudio,
  attachImage,
  completeUpload,
  detachAudio,
  detachImage,
  getUpload,
  presignUpload,
} from '../../../../../lib/api/media';

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

// -----------------------------------------------------------------------------
// MEDIA
// -----------------------------------------------------------------------------

// The upload path, as Server Actions. Every call below reaches the API with the
// caller's access token, which the browser never holds — auth.ts keeps it on
// the encrypted JWT and the session callback withholds it — so none of this can
// run from a client component.
//
// EXACTLY ONE STEP IS MISSING FROM THIS FILE: the PUT of the bytes, which goes
// from the browser straight to S3 against the presigned URL. That is what
// presigning is for, and it is the only part of the flow the API is not in.
//
// ⚠️ THE FIRST THREE ARE NOT EDITOR-SPECIFIC. presign, complete and status
// concern an asset that is not attached to anything yet, and the contributor
// media tab will want them too. They are here because the editor is the only
// caller today; moving them to a shared module is the right change the moment
// there is a second one, and doing it now would be structure without a user.

// Attaching returns NO updatedAt, unlike every other write in this file, and
// that is the contract rather than an omission: attaching sets a foreign key
// and deliberately does not move the parent's `updatedAt` (docs/adr/0020), so
// there is no optimistic lock to advance. Reusing SaveResult here would hand
// the card a version to store and quietly break its next save.
export type PresignResult =
  | { ok: true; assetId: string; uploadUrl: string; headers: Record<string, string> }
  | { ok: false; message: string };

export type UploadStatusResult =
  { ok: true; status: MediaStatus; error: string | null } | { ok: false; message: string };

function toMediaFailure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}

// Step 1. The row is created at AWAITING_UPLOAD before any bytes exist, and
// what comes back is a capability to write one object at one key.
//
// `Content-Length` IS STRIPPED HERE rather than left for the caller to notice.
// The API signs it, and the presign contract says to send the headers verbatim
// — but it is a forbidden header name: `fetch` ignores an attempt to set it and
// XHR throws. The browser writes it from the body, which is why the signature
// still matches. Filtering at the boundary means the one place that knows this
// is this comment, instead of every component that loops over the map.
export async function presignUploadAction(body: PresignUpload): Promise<PresignResult> {
  let presigned;
  try {
    presigned = await presignUpload(body);
  } catch (error) {
    return toMediaFailure(error, 'Could not start the upload');
  }
  if (!presigned) return { ok: false, message: 'The upload could not be prepared' };

  const headers = Object.fromEntries(
    Object.entries(presigned.headers).filter(([name]) => name.toLowerCase() !== 'content-length'),
  );

  return { ok: true, assetId: presigned.assetId, uploadUrl: presigned.uploadUrl, headers };
}

// Step 3, after the browser's PUT. The API HEADs the object and compares its
// size against what was signed before moving the row to PENDING and queueing
// it — "I uploaded it" is not evidence that anything is in the bucket.
//
// A failure here leaves the asset AWAITING_UPLOAD on purpose, so the same
// presigned URL can be retried rather than stranding it and signing another.
export async function completeUploadAction(assetId: string): Promise<UploadStatusResult> {
  let asset;
  try {
    asset = await completeUpload(assetId);
  } catch (error) {
    return toMediaFailure(error, 'Could not confirm the upload');
  }
  if (!asset) return { ok: false, message: 'The upload could not be confirmed' };

  return { ok: true, status: asset.status, error: asset.error };
}

// Step 4. Polled while the processor works, roughly every two seconds.
//
// Do not treat a ceiling as failure. The first upload of a session pays the
// Lambda cold start — 26.6s measured against 2.3s warm — so a short fixed
// timeout reports it as broken. Offer a manual re-check instead.
export async function uploadStatusAction(assetId: string): Promise<UploadStatusResult> {
  try {
    const asset = await getUpload(assetId);
    return { ok: true, status: asset.status, error: asset.error };
  } catch (error) {
    return toMediaFailure(error, 'Could not read the upload status');
  }
}

// Step 5. Order-independent: an asset may be attached before or after it
// finishes processing, and the gate refuses to publish one attached to nothing.
export async function attachAudioAction(
  entryId: string,
  translationId: string,
  assetId: string,
): Promise<ActionResult> {
  try {
    await attachAudio(translationId, assetId);
  } catch (error) {
    return toMediaFailure(error, 'Could not attach the recording');
  }
  revalidateEntry(entryId);
  return { ok: true };
}

export async function detachAudioAction(
  entryId: string,
  translationId: string,
): Promise<ActionResult> {
  try {
    await detachAudio(translationId);
  } catch (error) {
    return toMediaFailure(error, 'Could not remove the recording');
  }
  revalidateEntry(entryId);
  return { ok: true };
}

export async function attachImageAction(entryId: string, assetId: string): Promise<ActionResult> {
  try {
    await attachImage(entryId, assetId);
  } catch (error) {
    return toMediaFailure(error, 'Could not attach the image');
  }
  revalidateEntry(entryId);
  return { ok: true };
}

export async function detachImageAction(entryId: string): Promise<ActionResult> {
  try {
    await detachImage(entryId);
  } catch (error) {
    return toMediaFailure(error, 'Could not remove the image');
  }
  revalidateEntry(entryId);
  return { ok: true };
}
