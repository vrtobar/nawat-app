/**
 * Auth0 Post Login Action — nawat platform.
 *
 * NON-AUTHORITATIVE SNAPSHOT. The live Action in the Auth0 dashboard
 * (Actions -> Library -> Post Login) is where this runs; editing this file
 * deploys nothing. Reconciled against the live Action on 2026-08-19 and kept as
 * its mirror — paste this whole file into the dashboard to apply a change, so
 * the two stay identical. Managing it through the Auth0 Terraform provider or
 * a0deploy, so the repo becomes authoritative, is a BACKLOG item under Identity;
 * delete this file when that lands.
 *
 * The live Action does not yet set the locale claim — the last line below is the
 * only difference from what is currently deployed. Pasting this file adds it.
 *
 * Secrets are injected via the Action's Secrets panel, never inline:
 *   INTERNAL_SECRET — the shared secret guarding POST /auth/role
 *   API_URL         — e.g. https://api.nahuat.com. Per-tenant: the staging
 *                     tenant points at staging (ADR 0005; one Action cannot
 *                     serve two envs — see the Identity BACKLOG entries).
 *
 * @param {Event} event
 * @param {PostLoginAPI} api
 */
exports.onExecutePostLogin = async (event, api) => {
  const NAMESPACE = 'https://nahuat.com';

  let response;
  try {
    response = await fetch(`${event.secrets.API_URL}/api/v1/auth/role`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': event.secrets.INTERNAL_SECRET,
      },
      body: JSON.stringify({
        auth0Id: event.user.user_id,
        email: event.user.email,
        // name is non-nullable in the database and Auth0 omits it for some
        // connections (email OTP in particular); the email stands in.
        name: event.user.name || event.user.email,
        pictureUrl: event.user.picture ?? null,
      }),
    });
  } catch {
    // Could not reach the API. Deny rather than mint a token with no claims —
    // JwtStrategy rejects a token missing userId/role, so a "successful" login
    // would only hand back an unusable session.
    api.access.deny('Unable to complete sign in. Please try again.');
    return;
  }

  // 403 = USER_DEACTIVATED. This endpoint is the gate: revoking the Auth0
  // session does not by itself prevent a new login.
  if (response.status === 403) {
    api.access.deny('This account has been deactivated.');
    return;
  }

  if (!response.ok) {
    api.access.deny('Unable to complete sign in. Please try again.');
    return;
  }

  // Response envelope is { success, data } — see TransformInterceptor.
  const { data } = await response.json();

  // Namespaced per Auth0 requirement: a bare custom claim is silently dropped.
  // These land on the ACCESS token, the only one the API sees.
  api.accessToken.setCustomClaim(`${NAMESPACE}/userId`, data.userId);
  api.accessToken.setCustomClaim(`${NAMESPACE}/role`, data.role);
  // Not yet in the live Action; applying this file adds it. JwtStrategy reads
  // it as an optional claim, so older tokens without it stay valid. See ADR 0015 §4.
  api.accessToken.setCustomClaim(`${NAMESPACE}/locale`, data.locale);
};
