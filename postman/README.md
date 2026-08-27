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

**The API issues tokens now.** It is its own authorization server (ADR 18),
where it previously only verified what Auth0 minted — so there is no longer a
route on the web app to fetch one from, and no session cookie to copy into
Postman.

Locally, mint one directly:

```bash
npm run db:seed:dev                                      # the three dev users
npm run --silent auth:token --workspace=api -- admin     # or contributor | user
```

Paste it into `{{token}}`. The argument picks which seeded row the token names,
and that row must exist, so run the seed first. Tokens last 12 hours.

⚠️ **It is not a test double.** It signs with the same key the API verifies
with, so it is indistinguishable from a token issued by a real sign-in. The only
thing making it safe is that `JWT_SIGNING_KEYS` is per environment — the local
key signs nothing staging or production will accept.

Against **staging** that shortcut is unavailable, so you need a real sign-in:
sign in at `{{webBaseUrl}}`, take the `id_token` from the callback, put it in
`{{googleIdToken}}` and run **Session → Start session**. That writes both
`{{token}}` and `{{refreshToken}}`.

**Why local and staging differ on secrecy.** In the Local environment `token`
and `refreshToken` are ordinary variables — the local token is signed by a key
that exists only on your machine, with `iss`/`aud` of `localhost:3001`, so it
authenticates against nothing else and hiding it protects nothing. In Staging
they are marked secret, because a staging token is a real credential and this
directory is committed to a public repository: the type is what keeps the value
out of the file when the environment is exported. Never paste a deployed
environment's token into the Local one to save a step.

**Refresh** then rotates the pair without another sign-in. It is single-use:
the token you send dies as this returns, and sending the same one twice is
treated as theft and revokes the entire session. That is worth doing once
deliberately — run Refresh twice in a row and watch every authed request start
failing.

**A token does not carry your rank.** It carries only `sub` — which is
`User.id`, this API's own identifier — and the API reads role from that row on
every request. Changing a role in the database applies to the next request,
with no new token and no re-login.

- **Authed routes locally → mint one with `auth:token`.** It signs with the
  same key the API verifies with, so the token is indistinguishable from one
  issued by a browser sign-in — no dev bypass and no second code path.

  The token supplies only the subject; which rung you get is whatever the
  matching seeded user's row says, so changing a role in the database takes
  effect on the next request without minting anything new.

  ```bash
  npm run db:seed:dev                     # creates the three dev users
  npm run --silent auth:token --workspace=api -- admin
  ```

  Paste it into the Local environment's `token`. `admin`, `contributor` and
  `user` select which seeded user the token names, and the row must exist, so
  run the seed first. Tokens last 12 hours; mint another.

  This replaces the local mock OIDC issuer, deleted with the move to in-house
  authentication (ADR 18) — the API now accepts only tokens signed by its own
  key set, so a mock issuer cannot produce a usable one.

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
