# Postman collection

`nahuat-api.postman_collection.json` — the Nahuat API surface. Import it into
Postman (or any tool that reads Collection v2.1): **Import → File**, and import
the environment files alongside it.

The API is URI-versioned under `/api/v1`; health opts out at `/api/health`. To
run the API locally, see [../docs/local-development.md](../docs/local-development.md).

## Environments

Every URL is driven by `{{baseUrl}}`/`{{healthBase}}`, so pick an environment
(top-right in Postman) rather than editing the collection:

| Environment          | File                                      | Target                           |
| -------------------- | ----------------------------------------- | -------------------------------- |
| **Nahuat — Local**   | `nahuat-local.postman_environment.json`   | `http://localhost:3001`          |
| **Nahuat — Staging** | `nahuat-staging.postman_environment.json` | `https://api.staging.nahuat.com` |

Each defines `token` (secret) and the
`entryId`/`translationId`/`dialectId`/`slug` placeholders to fill from a
browse/list response. Add a production environment by copying the staging one and
swapping the host — but production is torn down between sessions
([ADR 17](../docs/adr/0017-production-disposable-during-prelaunch.md)) and is not
a hand-testing target.

## Auth

Every route is protected by a global guard unless marked public. Public routes
(dictionary reads, `GET /dialects`, health) work in every environment with no
token. Authed routes send `{{token}}` as a Bearer token.

Tokens are **real Auth0 access tokens** (RS256, verified via JWKS against the
tenant) — there is no local/HS256 bypass ([ADR 13](../docs/adr/0013-authentication-and-authorization.md)).

The token carries only `sub`. Since 2026-08-24 the API looks the platform user
id and role up in its own database on every request, so **the token does not
determine your role** — the user row does. A role change applies to the very
next request rather than at the next login, and a deactivated account is refused
with `USER_DEACTIVATED`.

- **Authed routes → use the Staging environment.** Log into the staging web app
  (`https://staging.nahuat.com`), copy the access token it sends to the API (from
  the Network tab's `Authorization` header, or the SDK session), and paste it into
  the Staging environment's `token`.
- **Authed routes locally → mint a token from the mock issuer.** A local OIDC
  issuer stands in for the tenant, swapping the _issuer_ and not the _strategy_
  — the API still verifies RS256 against a JWKS endpoint with issuer and
  audience pinned, so ADR 13 is intact.

  The minted token supplies only the `sub`; which rung you get is whatever the
  matching seeded user's row says, so changing a role in the database takes
  effect on the next request without minting anything new.

  ```bash
  npm run db:seed:dev                     # creates the three dev users
  npm run auth:mock --workspace=api       # leave running; serves JWKS on :8080
  npm run --silent auth:token --workspace=api -- admin
  ```

  Add both lines to `apps/api/.env.local` and restart the API:

  ```
  AUTH0_ISSUER_URL=http://localhost:8080/
  AUTH0_JWKS_URI=http://localhost:8080/jwks
  ```

  Paste the minted token into the Local environment's `token`. `admin`,
  `contributor` and `user` select which seeded user the token names. Tokens
  expire after an hour; mint another. The issuer must stay running — the API
  fetches its JWKS on every unseen `kid`.

There is no longer an internal endpoint for Auth0 to call. `POST /auth/role`,
the `x-internal-secret` header and the Post Login Action behind them were all
removed on 2026-08-24; a user row is created from Auth0's `/userinfo` on the
first request from an account the API has not seen before.

## Roles

Ranked `USER < CONTRIBUTOR < ADMIN`. Each folder notes its minimum role. A token
below the required rank gets a 403 that deliberately does not name the required
role.
