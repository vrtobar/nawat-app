# Local development

Setup, and the things that will waste an afternoon if nobody tells you.

Where this document and the code disagree, the code wins. Design decisions
live in [`docs/adr/`](adr/README.md).

## Requirements

- **Node 24+** and **npm 11+** (enforced by `engines` in `package.json`)
- **Docker**, for Postgres and Valkey

## First run

```bash
npm install                 # postinstall runs `prisma generate`
npm run dev:infra           # Postgres on :5432, Valkey on :6379
npm run db:migrate
npm run db:seed:dev         # reference data + placeholder content
npm run dev
```

Environment files are loaded from `.env.local` then `.env`, both gitignored.
Copy the examples in `apps/api/`, `apps/web/` and `packages/database/`. In
production none of these exist — environment comes from the ECS task
definition, and the loader no-ops.

`npm run dev:infra:down` stops the containers.

## What runs where

| URL                                      | What                                                    |
| ---------------------------------------- | ------------------------------------------------------- |
| `http://localhost:3000`                  | Web app. `/` redirects to `/es` or `/en` (proxy.ts)     |
| `http://localhost:3001/api/v1`           | API. URI-versioned; health opts out below               |
| `http://localhost:3001/api/health`       | Liveness — what the ALB polls                           |
| `http://localhost:3001/api/health/ready` | Readiness — checks the database                         |
| `localhost:5432`                         | Postgres, database `nahuat_dev`, user/password `nahuat` |
| `localhost:6379`                         | Valkey                                                  |
| `localhost:8080`                         | Mock OIDC issuer, only while `auth:mock` is running     |

Auth0 mounts its own routes on the web app; they are not localized and never
pass through the locale redirect:

| URL                  | What                                                        |
| -------------------- | ----------------------------------------------------------- |
| `/auth/login`        | Starts the round trip. `?returnTo=/es` comes back there     |
| `/auth/logout`       | Clears the app and tenant sessions                          |
| `/auth/callback`     | Auth0 redirects here. Must be registered in the dashboard   |
| `/auth/access-token` | Returns `{ token, expiresAt }` — how to get a token by hand |
| `/auth/profile`      | The ID token claims for the current session                 |

## Before pushing, run all four

```bash
npm run lint && npm run format:check && npm run typecheck && npm test
```

**`format:check` is the one that gets skipped**, because a change that
typechecks and passes tests feels finished. CI runs `prettier --check .` and
fails the pull request on whitespace — including in files you never opened, so
format-on-save never touched them.

## Gotchas

### After changing `schema.prisma`, regenerate _and_ force a rebuild

```bash
npm run generate --workspace=@nahuat/database
npx turbo run build --force --filter=@nahuat/database
```

Skipping either leaves stale types. The symptom is a typecheck error naming
enum values or fields that no longer exist, in files you did not touch:

```
src/modules/auth/auth.service.ts(47,36): error TS2322:
  Type 'Role' is not assignable to type '"USER" | "CONTRIBUTOR" | "ADMIN"'.
```

**Why `--force` is needed:** the generated client lands in
`packages/database/src/generated/`, which is gitignored. Turbo excludes
gitignored files when hashing task inputs, so regenerating the client changes
nothing turbo can see, and it serves the previous build from cache. The rebuilt
`dist/` is what the API typechecks against.

CI never hits this — it starts from a clean `npm ci` with no turbo cache
carried between runs — so it is a local-only failure, and it can also fail the
other way: a stale build passing against types the database no longer has.

### Prisma will not generate a rename or an enum-value drop

`migrate dev` emits `DROP COLUMN` + `ADD COLUMN` for a rename, which discards
the data. For dropping an enum value it warns and stops outright, because
PostgreSQL has no `ALTER TYPE ... DROP VALUE`.

Both cases need a hand-written migration. Hand-editing migrations is normal
here — see [ADR 12](adr/0012-migration-composition-and-index-ownership.md), and
`20260817211522_drop_reviewer_role` for a worked example of the enum type swap.

### `next build` rewrites a tracked file

It rewrites `apps/web/next-env.d.ts`, switching the referenced types from the
`next dev` paths to the build paths. It is unrelated churn — revert it unless
you changed it deliberately.

### Seeding is two commands on purpose

| Command               | What it does                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `npm run db:seed`     | Reference data only. Safe in any environment; the production deploy runs it after migrations. |
| `npm run db:seed:dev` | Reference data, a sample dictionary, and the three dev login users. Local and staging only.   |

The split is structural rather than a flag because the seed task's command is
overridden at run time, and a flag would put one typo between production and a
dictionary of invented Nawat. Everything reachable from the reference path must
be safe to apply to production on every deploy, forever — which is why the dev
users, one of them an ADMIN, live strictly on the other side of it.

**The sample entries are real headwords with fabricated detail** — the regional
variants, phonetics, examples and audio URLs are invented. They are test data,
not authoritative Nawat, and the file says so. Real vocabulary enters through
the API with validation and attribution, never through a fixture.

### Signing in locally

A browser login works against the staging Auth0 tenant. Nothing in the login
path calls the API any more — Auth0 authenticates, the callback sets a session,
and that is the whole round trip ([ADR 13](adr/0013-authentication-and-authorization.md)).

```bash
npm run dev --workspace=web    # :3000
npm run dev --workspace=api    # :3001
```

Sign in at `http://localhost:3000/es`. The header shows your name when it works.

**Your user row is not created by logging in.** It is created the first time the
API sees your token: it does not recognise the `sub`, fetches your profile from
Auth0's `/userinfo`, and inserts the row. To make that happen, open
`http://localhost:3000/auth/access-token` in the same browser (the session
cookie is what authorises it), copy the `token`, and call the API:

```bash
TOKEN='eyJ...'   # paste it
curl -s http://localhost:3001/api/v1/users/me -H "Authorization: Bearer $TOKEN"
```

You will be a `USER`. `role` defaults that way and no login path writes it — see
below for promoting yourself.

**If a real token 401s on the issuer or an unknown `kid`,** `AUTH0_ISSUER_URL`
and `AUTH0_JWKS_URI` are still set in `apps/api/.env.local` from the mock issuer
below. Comment them out and restart the API. Unset _is_ the deployed
configuration; they are not a fallback for missing configuration.

**The Accept/Decline consent screen is expected on localhost.** Requesting a
custom API `audience` triggers it, and Auth0 does not skip consent for a
`localhost` callback even though the application is first-party. Staging and
production do not show it.

**Declining is handled, not a 500.** The SDK's default renders a bare 500
carrying the raw error; an `onCallback` hook in `apps/web/lib/auth0.ts` redirects
back to `returnTo` with `?auth_error=denied` (or `failed` for anything else) and
the header renders a message.

**To sign in as somebody else,** logging out is not enough. It clears the app
session and the Auth0 tenant session, but not the upstream Google session, so
Auth0 silently re-authenticates you as the same person and only the consent
screen appears. Force a picker:

```
http://localhost:3000/auth/login?prompt=select_account
```

The SDK forwards unrecognised query parameters through to `/authorize`, stripping
only `connection`, `returnTo` and `scopes`. `prompt=login` forces a full
re-authentication if `select_account` is not enough.

### Poking at the local database

The seed and the API cover most of it, but role changes and sanity checks are
faster in `psql`. There is a shortcut for the connection:

```bash
npm run db:psql --workspace=@nahuat/database
```

That is `docker compose exec postgres psql -U nahuat -d nahuat_dev`, and it
takes arguments after `--`:

```bash
npm run db:psql --workspace=@nahuat/database -- -c "SELECT count(*) FROM entries;"
```

The full form is worth knowing too, since `-T` is what makes these safe to paste
into a script:

```bash
# Who exists? Seeded users are the `seed|` ones; yours came from a real login.
docker compose exec -T postgres psql -U nahuat -d nahuat_dev \
  -c "SELECT auth0_id, email, name, role, is_active FROM users ORDER BY created_at;"

# Promote yourself. Takes effect on the NEXT REQUEST — role is read from the
# database per request, so no re-login and no new token.
docker compose exec -T postgres psql -U nahuat -d nahuat_dev \
  -c "UPDATE users SET role='ADMIN' WHERE auth0_id NOT LIKE 'seed|%';"

# Exercise the deactivation gate. Refuses with 403 USER_DEACTIVATED, immediately.
docker compose exec -T postgres psql -U nahuat -d nahuat_dev \
  -c "UPDATE users SET is_active=false WHERE auth0_id NOT LIKE 'seed|%';"

# What is in the dictionary, and how much of it is draft?
docker compose exec -T postgres psql -U nahuat -d nahuat_dev \
  -c "SELECT count(*) AS entries, count(*) FILTER (WHERE NOT is_published) AS drafts FROM entries;"
```

`-T` disables TTY allocation, which is what lets these run from a script or a
one-liner rather than dropping into a prompt.

### Hand-testing without a browser

The mock OIDC issuer mints a token for a seeded user offline, which is useful
for curl, Postman and scripts. It swaps the _issuer_, not the _strategy_ — the
API still verifies RS256 against a JWKS endpoint with issuer and audience
pinned, so there is still no dev bypass.

```bash
npm run db:seed:dev                                      # the three dev users
npm run auth:mock --workspace=api                        # leave running
npm run --silent auth:token --workspace=api -- admin     # or contributor | user
```

Point the API at it in `apps/api/.env.local`, then restart:

```
AUTH0_ISSUER_URL=http://localhost:8080/
AUTH0_JWKS_URI=http://localhost:8080/jwks
```

Two variables rather than one, because Auth0 serves its keys at
`/.well-known/jwks.json` and the mock serves them at `/jwks`. Both are optional
and default to the Auth0 tenant, so staging and production set neither.

**The token only supplies the `sub`.** Which rung you get is whatever the
matching user's row says, so `admin`, `contributor` and `user` select a seeded
user rather than a claim — changing a role in the database takes effect without
minting anything new.

The signing key is cached in `apps/api/.mock-oidc-key.json` (gitignored) so
restarting the issuer does not invalidate tokens already minted. Delete it to
rotate.
