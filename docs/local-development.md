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

### Hand-testing a role-gated route

There is no dev bypass in the auth strategy, by design
([ADR 13](adr/0013-authentication-and-authorization.md)). Auth0 stamps the role
claim from a Post Login Action that calls back into the API, which it cannot do
for `localhost`, so a local OIDC issuer stands in and mints the token that
Action would have produced.

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

```bash
TOKEN=$(npm run --silent auth:token --workspace=api -- admin)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/v1/users/me
```

Two variables rather than one, because Auth0 serves its keys at
`/.well-known/jwks.json` and the mock serves them at `/jwks`. Both are optional
and default to the Auth0 tenant, so staging and production set neither.

The signing key is cached in `apps/api/.mock-oidc-key.json` (gitignored) so
restarting the issuer does not invalidate tokens already minted. Delete it to
rotate.

**Leave both unset to talk to real Auth0.** They are not a fallback for a
missing configuration — unset _is_ the deployed configuration.
