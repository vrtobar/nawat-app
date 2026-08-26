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

Each defines `token` (secret), `webBaseUrl` — the Next app, which is where
`/auth/*` is mounted and therefore where tokens come from — and the
`entryId`/`translationId`/`dialectId`/`slug` placeholders to fill from a
browse/list response.

`entryUpdatedAt` and `translationUpdatedAt` are filled in for you: the two
requests under **Admin read surface** write them, and the two `PATCH` requests
read them back as their optimistic lock (see below). You should not need to
touch them by hand. Add a production environment by copying the staging one and
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

### Getting a token into `{{token}}`

**Session → "Get access token → saves {{token}}"** does it for you: it calls
`{{webBaseUrl}}/auth/access-token` and a post-response script writes the result
into the active environment, so every authed request picks it up. Re-run it when
the token expires (an hour) rather than minting anything by hand.

That endpoint is on the **web app**, not the API — the API only ever verifies
tokens — and it authorises by **session cookie**. So Postman needs the cookie the
browser holds:

1. Sign in at `{{webBaseUrl}}` in the browser.
2. Copy the session cookie into Postman's **Cookies** manager (under the Send
   button) for that domain.
3. Run the request. The console reports the expiry it saved.

If you would rather not manage cookies, open `{{webBaseUrl}}/auth/access-token`
in the browser and paste the `token` value into the environment by hand — the
same value, one more step.

**A token does not carry your rank.** It carries only `sub`; the API reads role
from your user row on every request. Changing a role in the database applies to
the next request, with no new token and no re-login.

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
removed on 2026-08-24.

A user row is created by **logging in**: the web app's callback calls
`POST /auth/session` with the freshly issued token, and that is the only path
that provisions an account. The practical consequence for this collection is
that a token alone is not enough — **sign in through the web app at least once**
before using one here, or every authenticated request answers
`401 ACCOUNT_NOT_PROVISIONED`. The Session folder already gets its token from a
browser session, so following it satisfies this by construction.

## Roles

Ranked `USER < CONTRIBUTOR < ADMIN`. Each folder notes its minimum role. A token
below the required rank gets a 403 that deliberately does not name the required
role.

## Editing something: run the reads first

Both `PATCH` routes require **`expectedUpdatedAt`** — the `updatedAt` you last
read. The update is conditional on it, so a row that changed between your read
and your write answers **409 `EDIT_CONFLICT`** instead of silently overwriting
whatever the other person saved.

This is not ceremony. The editor sends every field on every save rather than a
diff, so an unconditional write puts back whatever the sender's form last
loaded — which, with two people on one translation, deletes the other's work
with nothing raised anywhere.

So the order is:

1. **Admin read surface → List entries** — saves `{{entryId}}`
2. **Admin read surface → Entry detail** — saves `{{entryUpdatedAt}}`,
   `{{translationId}}`, `{{translationUpdatedAt}}`
3. **Update entry** or **Update translation**

Running a `PATCH` without step 2 sends an empty lock and gets a validation
error; running it twice without re-reading gets the 409, which is the mechanism
working rather than a bug. Re-run step 2 after any successful write.
