# 18. Authentication moves in-house, with Google as the only identity provider

- **Status:** Accepted
- **Date:** 2026-08-25
- **Applies to:** `apps/api/src/modules/auth/`, `apps/api/src/common/guards/`,
  `apps/web/lib/auth0.ts`, `apps/web/proxy.ts`
- **Supersedes:** [ADR 5](0005-auth0-tenant-separation.md) once implemented —
  tenant separation stops being a question when there is no tenant
- **Amends:** [ADR 13](0013-authentication-and-authorization.md). Its
  authorization half survives intact; only token issuance and verification
  change
- **Implementation order deliberately not fixed here.** The decision is
  recorded; when it is built is a separate call, and the reasoning for the
  timing is in Consequences

## Context

Auth0 was chosen for two things: social login and email OTP. Only one of them is
still wanted, and the other has been the more expensive half.

**What the dependency has actually cost**, from this repository's own history
rather than in principle:

- **Configuration that is not code, and cannot be.** The Post Login Action lived
  as a file pasted into a dashboard, mirrored here by hand under a header
  admitting "editing this file deploys nothing". It could not be tested,
  reviewed against what ran, versioned with the code that depended on it, or
  rolled back with a release. It was deleted for exactly those reasons
  ([ADR 13](0013-authentication-and-authorization.md)), but the category
  remains: callback URLs, allowed logout URLs and connection settings are all
  still dashboard state. On 2026-08-25 a logout failed against the Allowed
  Logout URLs list, which no amount of care in this repository could have
  prevented or detected.
- **One tenant cannot serve two environments.** The free plan allows one tenant
  per account, so local development and staging share one. Identity is shared
  and rows are not: the same subject, a different row per environment, an
  independent role, and tokens interchangeable between the two APIs because the
  issuer and audience match. [ADR 5](0005-auth0-tenant-separation.md) records
  the intent to separate them and it has not happened, because doing so means a
  second account rather than a setting.
- **Local development cannot reach the identity provider.** Auth0's servers
  cannot call `localhost`, which is why `apps/api/scripts/mock-oidc` exists at
  all — a second OIDC issuer maintained purely so role-gated routes can be
  exercised without a browser.

**What it is still providing** is a redirect to Google, an ID token, and a JWKS
endpoint. That is the part with the fewest moving pieces and the most mature
libraries.

## Decision

### The API is the authorization server

The web application redirects to Google, receives the authorization code, and
posts it to the API. The API exchanges the code, verifies Google's ID token
against Google's JWKS, resolves or creates the account, and issues the token the
rest of the system already understands.

Three shapes were possible and the choice between them matters more than the
choice of provider:

|                             | Where the signing key lives | Cost                                             |
| --------------------------- | --------------------------- | ------------------------------------------------ |
| Web issues, API verifies    | Both services               | Two copies of one secret, rotated in lockstep    |
| **API issues and verifies** | **API only**                | **The API handles the OAuth exchange**           |
| Session cookie, no token    | Nowhere; state in Valkey    | The API stops being callable with a bearer token |

**The API issuing is chosen** because it keeps the signing key in one process.
The alternative where the web app mints tokens would put the same secret in two
services and reintroduce precisely what
[ADR 13](0013-authentication-and-authorization.md) records as a property worth
having: today no shared secret exists for token verification, because the API
holds only a public key and cannot mint a token at all.

**That property is weakened by this decision and the weakening is deliberate.**
An API that issues tokens can forge them by definition. What is preserved is
that the key exists in exactly one place, is never transmitted, and is not
shared with the web tier — which is a smaller claim than today's, and is stated
here so the next reader does not assume it was overlooked.

**The session-cookie option was rejected** on a specific consequence rather than
on taste: the API would stop being independently callable with a bearer token.
The Postman collection, any script, and any future mobile client all depend on
that, and replacing it would mean a second authentication mechanism — which is
the thing this decision is trying to reduce.

### Google is the only identity provider

Facebook was considered and dropped. It requires app review for the `email`
permission and business verification, and has a history of breaking changes —
re-importing a meaningful share of the third-party friction this decision exists
to remove. Adding it later is a self-contained change if the audience turns out
to need it.

### Email OTP is dropped, and that is a product decision

Recorded separately because it is separable: OTP could be kept with an
in-house implementation, and it could have been dropped while remaining on
Auth0. The two questions were deliberately not bundled.

Sign-in requires a Google account. For an audience of Salvadorans including
diaspora, Google is close to universal, and the cost of excluding the remainder
is judged lower than the cost of owning email authentication.

**What owning email would mean is the reason it is not being taken on**, and it
is the part Auth0 was genuinely worth paying for: verification emails, a
magic-link or password-reset flow with single-use expiring tokens, rate
limiting, and enumeration resistance on every endpoint that takes an address.
Deferring it is a real deferral, not an avoided cost — if email sign-in is ever
wanted, that work appears in full.

### What does not change

Most of the authorization model, which is about this system's own database
rather than about Auth0:

- Identity resolved per request from `users.auth0Id` — the column name becomes
  inaccurate and should be renamed with the migration, but the mechanism stands
- Accounts created at login by `POST /auth/session`, and nowhere else
- Verification and identity resolution separated between `JwtStrategy` and
  `JwtAuthGuard`, with `@AllowMissingAccount` on the one route that must be
  reachable without an account
- Ranked roles, `@Roles`, `@Public`, `@CurrentUser`, the deactivation gate,
  `lastLoginAt`, the profile re-sync, and the refusal to merge two identities
  sharing an email

The token's shape and its issuer change. What the API does with a verified
subject does not.

## Consequences

- **A signing key becomes an operational concern.** It needs generating,
  storing in Secrets Manager alongside the existing secrets, injecting into the
  API task definition, and a rotation story. Asymmetric signing is preferred so
  that a future consumer can verify without holding the ability to mint.
- **`@auth0/nextjs-auth0` is removed**, and with it the session handling,
  callback route, and token refresh it provided. That is a real quantity of
  behaviour to replace. **Auth.js is preferred over hand-rolling**: it is a
  library rather than a service, it keeps every artifact in this repository, and
  it handles the `state` parameter, PKCE, and session cookies — the parts where
  a hand-rolled implementation is most likely to be quietly wrong.
- **The mock OIDC issuer can be deleted.** Google permits `localhost` redirect
  URIs, so local development uses the same flow as every other environment. This
  removes the second issuer, the shared-tenant confusion, and the class of
  problem where a token minted for one environment is silently accepted by
  another.
- **`ADR 5` becomes moot.** Environment separation was a question about tenants,
  and a Google OAuth client per environment is ordinary configuration.
- **CSRF, PKCE and session fixation become this project's responsibility.**
  Google verifies the human and no password is ever handled here, but the flow
  around it is now owned. This is well-trodden ground, which is the argument for
  a library rather than for confidence.
- **`users.auth0Id` should be renamed** — `subject` or `googleId` — in the same
  migration, or the schema will describe a vendor that is no longer involved.
- **Timing is open, and the argument cuts both ways.** Authentication currently
  works and was verified end to end on 2026-08-25; rewriting it immediately
  means discarding freshly proven code to solve a problem that is not presently
  costing anything, while the entry editor remains the actual blocker on the
  project having content. Against that, the friction is daily and falls hardest
  on local development of authenticated features — so if such work is imminent,
  doing this first stops paying the tax twice. The migration itself can take the
  environments down without consequence
  ([ADR 17](0017-production-disposable-during-prelaunch.md)), so downtime is not
  a factor in the ordering.

## Alternatives considered

**Stay on Auth0 and drop only OTP.** The cheapest option, and it addresses none
of the recorded costs: the dashboard configuration, the shared tenant, and the
unreachable-from-localhost problem all persist unchanged. It is the right choice
only if the ability to add email sign-in cheaply is worth more than those three
combined.

**Keep Auth0 and pay for a second tenant.** Resolves [ADR 5](0005-auth0-tenant-separation.md)
and nothing else. The Post Login Action failure and the logout-URL failure would
both still have been possible.

**Sign in with Google Identity Services directly in the browser**, sending the
resulting credential to the API. Fewer redirects, and it is what most consumer
applications do — but it moves the flow into client-side JavaScript, and the
server-side code exchange keeps the client secret and the exchange itself out of
the browser entirely.
