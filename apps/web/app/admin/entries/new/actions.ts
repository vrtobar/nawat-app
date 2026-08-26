'use server';

import { type CreateFullEntry } from '@nahuat/shared';
import { revalidatePath } from 'next/cache';

import { createFullEntry } from '../../../../lib/api/admin';

export type CreateEntryResult = { ok: true; id: string } | { ok: false; message: string };

// Creating an entry with its translations, as a Server Action.
//
// An action rather than a Server Component call for the reason publishing is:
// the Auth0 SDK can only persist a refreshed access token where cookies can be
// set, which a Server Component cannot do, and React forbids side effects
// during render regardless.
//
// Returns a result instead of throwing. A duplicate headword or a validation
// failure is an ordinary outcome of filling in a form, and the error boundary
// is a wildly disproportionate response to one.
export async function createEntryAction(body: CreateFullEntry): Promise<CreateEntryResult> {
  let created;
  try {
    created = await createFullEntry(body);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not create the entry',
    };
  }

  // The write response is resolved to the caller's locale and drops
  // translations lacking content in it, so it is not the new state and nothing
  // here treats it as such. `id` is the one field no resolution touches.
  if (!created) {
    return { ok: false, message: 'The entry was created but the response was empty' };
  }

  // The new row joins the draft queue, so the list is refetched rather than
  // patched — its counts and pagination move with it.
  revalidatePath('/admin/entries');
  return { ok: true, id: created.id };
}
