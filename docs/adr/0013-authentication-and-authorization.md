# 13. Authentication and authorization model

- **Status:** Accepted
- **Date:** 2026-08-16 (records decisions taken 2026-08-15)
- **Applies to:** `apps/api/src/common/guards/`, `apps/api/src/modules/auth/`
- **Amended 2026-08-17:** `REVIEWER` was removed from the role ladder. The
  decision below — ranked roles rather than capabilities — is unchanged; the
  ladder is three rungs instead of four. See the note in Consequences.
- **Amended 2026-08-23:** the token _issuer_ became configurable so local
  development can verify against a mock OIDC provider. The decision below —
  RS256 verified against a JWKS endpoint, with no symmetric path — is
  unchanged. `TEST_JWT_SECRET` was deleted. See "The issuer is configurable,
  the strategy is not" below.

## Context

Auth0 issues the tokens ([ADR 5](0005-auth0-tenant-separation.md)). The API has
to decide, on every request, who the caller is and what they are allowed to do.

Three questions come as a set, because each one's answer constrains the others:
what happens to a route nobody decorated, where the caller's role comes from,
and how a token is verified. Answering them separately is how a system ends up
with an endpoint that is protected in one sense and not the other.

There is also one route that cannot use a token at all. `POST /auth/role` is
called by the Auth0 Post Login Action **during** login — it is what produces the
claims a token will carry, so no token exists when it runs.

## Decision

### Authentication is the default; exposure is the explicit act

`JwtAuthGuard` is bound globally through `APP_GUARD`. Every route requires a
valid Auth0 token unless it carries `@Public()`.

The argument is entirely about which mistake you would rather make, because both
defaults get forgotten at the same rate:

| Forgotten                     | Under default-deny    | Under opt-in                  |
| ----------------------------- | --------------------- | ----------------------------- |
| Decorator on a new controller | 401 on the first call | Endpoint open to the internet |
| How you find out              | Immediately, in dev   | Possibly never                |

The guard resolves `@Public()` with `getAllAndOverride` across the handler and
the class, so it can be applied to either. Two things use it today: the health
controller, at class level, and `POST /auth/role`.

The health controller's exemption is not incidental. The ECS probe carries no
credentials, so without `@Public()` the container fails its own health check,
the service never reaches steady state, and the deployment circuit breaker rolls
back a release whose application code was working perfectly. That is the cost of
this default made concrete: its failure mode is a confusing rollback rather than
an open endpoint.

`RolesGuard` is registered **after** `JwtAuthGuard`. Nest runs global guards in
registration order and `RolesGuard` reads the user the first one attaches;
reversed, every `@Roles` route would 403 because no user exists yet. Route-level
guards run after both, which is why `POST /auth/role` can be `@Public()` and
still not be public — `InternalSecretGuard` applies to it.

### Authorization comes from the token, so it costs no query

`request.user` is the verified claim set, not a database row. Auth0 requires
custom claims to be namespaced, so the role and the platform user id arrive as
`https://nahuat.com/role` and `https://nahuat.com/userId`, and `validate()` maps
them onto `JwtClaimsSchema` from `packages/shared` — the same schema the
frontend types against ([ADR 10](0010-zod-as-the-payload-contract.md)).

A `@Roles` check is therefore an integer comparison against an in-memory object.
No route pays for a user lookup to find out whether it is allowed to run.

A correctly signed token missing those claims is rejected as **unauthenticated**
rather than as a server error: it means the token predates the Post Login Action
or came from a flow that skips it, and the client should re-authenticate rather
than see a 500.

### RS256 only, and no symmetric path exists

Auth0 signs with RS256 and the public key is fetched from the tenant's JWKS
endpoint, cached by `jwks-rsa`. Key rotation therefore needs no deploy, and
`rateLimit` with `jwksRequestsPerMinute: 5` bounds the requests an attacker can
induce by flooding the API with tokens carrying unknown key ids.

Three verification parameters are pinned deliberately:

- **`algorithms: ['RS256']`.** Left open, a token signed with `none` — or with
  HS256 using the public key as the HMAC secret — would verify.
- **`audience`.** Without it, a token minted by the same tenant for a different
  API is accepted here.
- **`issuer`.**

No shared secret exists in this service for token verification, so nothing here
can leak in a way that lets an attacker mint a token.

**No symmetric path exists, and no `NODE_ENV` bypass.** Honouring a shared
secret would mean the running service accepts symmetric tokens whenever some
variable happens to be present, so anyone holding the value could forge
`role: ADMIN`. Gating that on `NODE_ENV` does not fix it — it relocates the
failure to a misconfigured environment, and the branch itself is the
vulnerability. Integration tests override the guard through Nest's testing
module instead, which leaves this path single-algorithm with nothing to get
wrong.

_Amended 2026-08-23._ This section originally documented `TEST_JWT_SECRET`, an
optional variable declared in `env.validation.ts` and set in `.env.example`
that no code read. The entry named its own cost: a declared-but-unused
variable reads as unfinished work, and the instinct of the next person to see
it is to wire it up. That is exactly what was proposed, and the amendment below
is what was built instead. The variable has been deleted.

### The issuer is configurable, the strategy is not

_Added 2026-08-23._

Everything above left one thing impossible: exercising a role-gated route
locally. The role claim is stamped by an Auth0 Post Login Action that calls
back into the API, and Auth0's servers cannot reach `localhost`, so no
ADMIN-claimed token could exist against a local server. The only ways to get
one were a real staging login or a tunnel — both heavyweight, neither wanted
for routine work. Write-path _logic_ was already covered by the `.spec` suites,
which override the guard through Nest's testing module; what was missing was
end-to-end confidence against a live local server, and any way at all to hand-
test the ADMIN-gated content-entry routes that authoring depends on.

`AUTH0_ISSUER_URL` and `AUTH0_JWKS_URI` are optional, and default to the values
derived from `AUTH0_DOMAIN`. Staging and production set neither and behave
exactly as before. Local development points them at a mock OIDC provider
(`apps/api/scripts/mock-oidc`) that serves a JWKS and mints RS256 tokens with
arbitrary claims.

**This is a different kind of change from the bypass rejected above, and the
difference is the whole argument.** A `NODE_ENV` or shared-secret bypass adds a
branch to the running service — a second way to be authenticated, which is
wrong in exactly one environment away from where it was tested. Swapping the
issuer adds no branch. `algorithms: ['RS256']`, `audience` and `issuer` are
still pinned and still applied unconditionally; the service still trusts only
RS256 verified against a published JWKS. What moved is which URL the keys are
read from — a value that already came from configuration, since `AUTH0_DOMAIN`
determined it. The trust surface is the same size; nothing new can be wrong.

Two variables rather than one derived from the other, because the paths
genuinely differ: Auth0 serves `/.well-known/jwks.json` and the mock serves
`/jwks`. Deriving one from the other looked tidier and simply 404s.

A consequence worth stating plainly: **anything that can set these variables
can make the API trust a different key.** That was already true of
`AUTH0_DOMAIN` — the JWKS URL was built from it — so this widens no boundary.
It does mean the deployed task definitions must keep leaving both unset, which
is the case today; the defaults are not a fallback for a misconfiguration, they
are the production configuration.

Tokens name a real `User.id` in their `userId` claim, so the seed creates three
dev users, one per rung, on the `--dev` path only. Content attribution is a
non-null foreign key: a token pointing at no row authenticates and then fails
the first write. See `packages/database/src/dev-users.ts`.

### Roles are ranked, not matched

```
USER         published content only
CONTRIBUTOR  + read, create and edit unpublished content
ADMIN        + publish, manage users, destructive operations
```

_Amended 2026-08-17 — this originally listed `REVIEWER` between USER and
CONTRIBUTOR, holding read-only access to drafts. Draft reading folded into
CONTRIBUTOR when REVIEWER was removed._

`@Roles('CONTRIBUTOR')` therefore admits ADMIN without naming it, and ADMIN
passes every check by construction rather than by special case — which is the
property the ladder exists for. No handler ever has to remember to list ADMIN
alongside another role, and forgetting to cannot lock admins out.

**This holds only while the ladder does.** A future role that is not a strict
superset of the one below — someone who edits translations but not lesson
structure — breaks ranking outright, and the answer then is capabilities, not a
fourth rank. Three linear roles is well inside where ranks are the simpler
answer; the fourth role is the thing to watch for.

Two failure modes are deliberate:

- **`@Roles` combined with `@Public` fails closed.** That combination is a
  contradiction — nobody unauthenticated holds a role — so there is no user on
  the request. The guard throws 403 rather than reading `.role` off `undefined`
  and returning 500.
- **The required role is never disclosed.** Telling a USER that an endpoint
  needs ADMIN maps the permission model for someone who can do nothing with the
  information.

### The one route a token cannot protect

`POST /auth/role` is guarded by a shared secret in `x-internal-secret`, held by
Auth0's Action secrets and AWS Secrets Manager. This is a different mechanism
from JWT verification, and weaker in a specific way worth stating: compromising
this value lets someone call this endpoint, but not mint a token.

Both sides are SHA-256'd to a fixed 32 bytes and compared with
`timingSafeEqual`. The hashing is not decoration — `timingSafeEqual` throws when
its inputs differ in length, so comparing raw strings would leak the secret's
length through an exception, and a plain `===` returns at the first differing
byte, which recovers the secret one character at a time from response timing. A
missing header and a wrong one produce the same message, so a prober cannot
confirm the header name.

Three further properties of that endpoint follow from the same reasoning:

- **POST, not the documented GET**, because it upserts. A GET that writes may be
  retried or cached by intermediaries, and passing the profile as query
  parameters would put the user's email and name into every access log.
- **`role` is never written there.** It is set by an admin through the users
  module; syncing it from Auth0 would let any login reset privileges.
- **Deactivated accounts are refused before the upsert**, with
  `USER_DEACTIVATED`, and their profile is left untouched. This closes a real
  gap: revoking an Auth0 session prevents nothing about a _new_ login, so a
  soft-deleted user would otherwise sign back in and receive a working token.

## Consequences

- **A role change does nothing until the Auth0 session is revoked and the user
  signs in again.** This is the direct price of authorizing from claims, and
  nothing inside the API can shorten it — the old token remains signed,
  unexpired, and valid, and the whole point of the design is that no route
  consults the database to second-guess it.
- **That consequence is currently unobservable, because nothing can change a
  role.** There is no users admin module. `@Roles()` appears on **zero** routes —
  only in its own definition, in the guard, and in the guard's tests. No
  `DELETE /users/:id` exists despite comments referring to one, and nothing
  reads `AUTH0_MGMT_CLIENT_ID` or `AUTH0_MGMT_CLIENT_SECRET`, though
  `env.validation` requires both at boot. The authorization half of this record
  is fully built, globally enforced, and has nothing yet to enforce.
- **The staleness window is partly closed elsewhere, by a different
  mechanism.** `GET /users/me` returns 401 — not 404 — when the row is missing,
  soft-deleted, or inactive, so a session that outlives its user stops working
  on any route that reads the profile. That is a per-route check rather than a
  global one: a route authorizing purely from claims would not notice.
- Deactivation is consequently enforced at two points for two different
  reasons — `/auth/role` refuses a new login, `/users/me` refuses an
  already-issued token.
- **401 responses carry the reason the token was rejected** — `jwt expired`
  versus `invalid signature` is the difference between the client refreshing and
  the client being wrong. Passport's default discards it, and reading only
  `info` genuinely cost debugging time once: a token rejected for missing claims
  returned "Authentication required", and it had to be decoded by hand to find a
  fault the API had already diagnosed and thrown away.
- A 403 tells a developer nothing about what was required, by design. The
  information is in the source, and the tradeoff favours the unprivileged caller
  learning nothing over the developer being told.
- **`REVIEWER` has no members and no route distinguishes it.** It is kept
  because an unused enum value is inert, while removing a value from a
  PostgreSQL enum costs a type swap on a live table. Worth revisiting only if it
  is still empty when the admin panel exists.

  **Resolved 2026-08-17 — removed.** Revisited earlier than this record
  anticipated, because the question turned out not to need the admin panel to
  answer it: anyone documenting real Nawat data would be a CONTRIBUTOR, so the
  role has no population to wait for. Both halves of the argument above then
  pointed the same way — the benefit of keeping it was gone, and the cost of
  removing it was near zero with one row in the table and no index on the
  column.

  The type swap it warned about is real and cannot be avoided: PostgreSQL has
  no `ALTER TYPE ... DROP VALUE`, so the migration renames the type, creates a
  replacement, drops and restores the column default around the cast, and drops
  the old type. The cast is deliberately left able to fail — a row still
  holding `REVIEWER` aborts the migration rather than being silently rewritten.

  Draft reading folded into CONTRIBUTOR. The ladder stays a strict superset
  chain, so the ranking argument above is untouched.

- `JwtClaimsSchema` is the single definition of the claim shape. It originally
  required `email` and `name`; those are ID token claims, held by the browser
  and never sent to the API, so every genuine access token failed validation
  until they were dropped. Adding them as custom claims would have made the
  schema true and put PII in every request — the profile is read from the
  database instead, where `/auth/role` syncs it on each login.

## Open question

The Post Login Action that produces these claims is tenant-level, and the
staging tenant serves both staging and local development — so one Action holds
one `INTERNAL_SECRET` and calls one API URL, and the two environments' secrets
are genuinely different. Whichever the Action holds, the other environment's
`/auth/role` rejects it.

This was not anticipated by [ADR 5](0005-auth0-tenant-separation.md), whose
whole argument is that one Action should be able to reach exactly one API.
Branching the Action on `event.client.client_id` would restore that capability
and reintroduce precisely the pattern ADR 5 rejects — less severe between local
and staging than between staging and production, but the same shape. The
current leaning is instead to point the Action at staging only and set roles by
hand in the local database, which is simplest while there is one developer.
Unresolved, and nothing is broken until the Action is built.

## Alternatives considered

**Opt-in authentication, `@UseGuards(JwtAuthGuard)` per controller.** The
NestJS-documented shape. Rejected purely on the asymmetry above: both defaults
are forgotten equally often and only one of them fails loudly.

**Authorize from the database on every request.** Look the user up and read the
current role. Removes staleness entirely — a role change takes effect on the
next request and a deactivated account dies immediately. Rejected because it
adds a query in front of every authenticated route to track a value that changes
a handful of times per account, and the staleness it removes is bounded by
session lifetime and already handled where it currently matters. **This is the
alternative most likely to become correct later:** if role changes become
frequent, or immediate revocation becomes a requirement rather than a nicety,
this is the change to make — cached, not raw.

**Store roles in Auth0 metadata and treat Auth0 as the source of truth.**
Rejected because it makes a login capable of resetting privileges, and puts
authorization state outside the database the admin panel edits.

**Capabilities instead of ranked roles.** More expressive, and immune to the
non-superset problem. Rejected as premature for four roles that genuinely form a
ladder, and recorded here as the migration path rather than as a rejected idea —
the fifth role that does not fit is what triggers it.

**Exact-match roles, `@Roles('CONTRIBUTOR', 'ADMIN')`.** Rejected because every
handler would have to remember ADMIN, and forgetting it locks administrators out
of a route with no error to indicate why.

**Accept HS256 tokens outside production.** Rejected: a `NODE_ENV` gate
relocates the failure to a misconfigured environment instead of removing it, and
the branch is itself the thing that can go wrong.

**`jose` instead of Passport.** A single strategy does not need Passport's
multi-strategy orchestration, so this was genuinely close. Passport was chosen
because it is the convention a NestJS reviewer expects, and the cost of the
convention here is one extra dependency rather than a second definition of
anything.
