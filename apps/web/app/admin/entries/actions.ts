'use server';

import { revalidatePath } from 'next/cache';

import { publishEntry } from '../../../lib/api/admin';

export type PublishResult = { ok: true } | { ok: false; message: string };

// Publishing, as a Server Action.
//
// A Server Action rather than a Server Component call for two reasons, one of
// them specific to this stack: React forbids side effects during render, and
// the Auth0 SDK can only persist a refreshed access token where cookies can be
// set — which a Server Component cannot do and an action can (see getApiToken).
//
// Returns a result instead of throwing. A thrown error in an action reaches the
// user as the error boundary, which for "this entry was already published" is a
// wildly disproportionate response.
export async function publishEntryAction(id: string): Promise<PublishResult> {
  try {
    await publishEntry(id);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Publishing failed',
    };
  }

  // The row leaves the draft list, so the whole list is refetched rather than
  // patched in place — the counts and pagination move with it.
  revalidatePath('/admin/entries');
  return { ok: true };
}
