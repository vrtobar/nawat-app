'use server';

import { revalidatePath } from 'next/cache';

import { publishMediaAsset, unpublishMediaAsset } from '../../../lib/api/media';

// The approval gate's two actions.
//
// Result objects rather than throws, matching the editor's convention: a
// refusal here is an ordinary outcome — the asset is attached to nothing, or
// the processor produced derivatives the gate cannot act on — and an error
// boundary would replace a sentence with a blank screen.
export type ReviewResult = { ok: true } | { ok: false; message: string };

// Publishing moves objects between S3 prefixes and writes a URL onto a
// dictionary row, so it changes what the public dictionary serves as well as
// what this queue shows. Both are revalidated: the entry pages read the URL
// this writes, and leaving them cached would show an entry with no audio for
// as long as the cache held.
function revalidateReview() {
  revalidatePath('/admin/media');
  revalidatePath('/admin/entries');
}

export async function publishMediaAction(assetId: string): Promise<ReviewResult> {
  try {
    await publishMediaAsset(assetId);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not publish' };
  }
  revalidateReview();
  return { ok: true };
}

// Removes the public objects and clears the URL. `pending/` is left alone, so
// this is reversible without reprocessing — which is why it is offered as an
// ordinary action rather than guarded as a destructive one.
export async function unpublishMediaAction(assetId: string): Promise<ReviewResult> {
  try {
    await unpublishMediaAsset(assetId);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not unpublish' };
  }
  revalidateReview();
  return { ok: true };
}
