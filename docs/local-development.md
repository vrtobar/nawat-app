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

| Command               | What it does                                                                  |
| --------------------- | ----------------------------------------------------------------------------- |
| `npm run db:seed`     | Reference data only. Safe in any environment; this is what the ECS task runs. |
| `npm run db:seed:dev` | Reference data plus placeholder content, for local work.                      |

The split is structural rather than a flag because the seed task's command is
overridden at run time, and a flag would put one typo between production and a
dictionary of invented Nawat. **The placeholder entries are not real Nawat** —
they are deliberately implausible (`zzz-placeholder-one`) so they cannot be
mistaken for data.
