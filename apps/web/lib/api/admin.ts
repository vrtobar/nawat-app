import { AdminEntryListItemSchema, type AdminEntryStatus, UserProfileSchema } from '@nahuat/shared';

import { authedItem, authedPage, mutate } from './client';

// GET /users/me — the signed-in user's own profile.
//
// This is where the panel learns its own role, and it is the authoritative
// place to learn it. The access token carries no role claim: the API resolves
// role from the user row on every request (ADR 13, "Reversal: identity is
// resolved per request"), and this endpoint reads that same row. So what the
// panel shows and what the API will permit cannot disagree — a promotion is
// visible here on the next request, with no new token and no re-login.
export function getMe() {
  return authedItem('/users/me', UserProfileSchema);
}

// GET /admin/entries — entries including drafts, which no public read returns.
// A CONTRIBUTOR sees only their own rows and an ADMIN sees every author's; the
// scoping is the API's, applied from the token's subject, so there is nothing
// to pass here and nothing this side could get wrong.
export function listAdminEntries(params: { status?: AdminEntryStatus; page?: number } = {}) {
  return authedPage('/admin/entries', AdminEntryListItemSchema, {
    status: params.status,
    page: params.page,
  });
}

// PATCH /entries/:id/publish — ADMIN. Publishes the entry and cascades to its
// draft translations. Returns the entry detail, which this discards: the caller
// revalidates the list rather than reconciling one row into it.
export function publishEntry(id: string) {
  return mutate(`/entries/${encodeURIComponent(id)}/publish`, { method: 'PATCH' });
}
