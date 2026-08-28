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

Auth.js mounts its own routes on the web app under `/auth`; they are not
localized and never pass through the locale redirect:

| URL                     | What                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `/auth/signin`          | Starts the round trip. `?callbackUrl=/es` comes back there      |
| `/auth/signout`         | Clears the cookie AND revokes the session on the API            |
| `/auth/callback/google` | Google redirects here. Must be registered on the OAuth client   |
| `/auth/session`         | The session as the browser may see it — profile only, no tokens |
| `/auth/failed`          | Where a refused sign-in lands, with a reason                    |

## Before pushing, run all four

```bash
npm run lint && npm run format:check && npm run typecheck && npm test
```

**`format:check` is the one that gets skipped**, because a change that
typechecks and passes tests feels finished. CI runs `prettier --check .` and
fails the pull request on whitespace — including in files you never opened, so
format-on-save never touched them.

## Reaching a deployed database

Sometimes the question is about staging's data rather than the local copy —
whether a migration landed, what a real login actually wrote, why a row looks
the way it does.

There is no direct route. RDS runs with `publicly_accessible = false` in private
subnets, and ECS Exec is disabled on the services. Exec would not help even if
it were enabled: `ecs execute-command` runs a command inside a task, while port
forwarding needs an SSM _managed instance_, which a Fargate task is not.

The path is an SSM bastion — a `t4g.nano` with no public IP, no key pair and no
inbound rules at all. Session Manager works by the agent dialling out, so there
is nothing listening to connect to and nothing to scan for. Access is an IAM
question rather than a network one: whoever can call `ssm:StartSession` gets in,
and nobody else does.

```bash
./infra/scripts/db-tunnel.sh staging          # localhost:5433 -> staging RDS
./infra/scripts/db-tunnel.sh staging 5555     # pick the local port
./infra/scripts/db-tunnel.sh staging --print-dsn   # connection string, then exit
```

It reads the instance id, the RDS endpoint and the database name from Terraform
outputs rather than taking them as arguments. A hostname typed by hand is how
someone ends up connected to production while believing they are in staging.

Needs the Session Manager plugin, which is separate from the AWS CLI:

```bash
brew install --cask session-manager-plugin
```

### You will also need a psql that is not `db:psql`

`npm run db:psql` is `docker compose exec postgres ...` — it talks to the local
container and cannot see a forwarded port. Three options that can:

```bash
# Docker, no install. From inside a container localhost is the container,
# so the host is reached as host.docker.internal.
docker run --rm -it -e PGPASSWORD="$PGPASSWORD" postgres:16-alpine \
  psql -h host.docker.internal -p 5433 -U nahuat -d nahuat

# A real client on the PATH
brew install libpq && brew link --force libpq
psql "postgresql://nahuat@localhost:5433/nahuat"
```

Or point any GUI client (TablePlus, DBeaver, pgAdmin) at `localhost:5433`. The
password comes from the AWS-managed RDS secret; `--print-dsn` prints a full
connection string including it.

The bastion deliberately cannot read that secret. The tunnel forwards a TCP
port and authentication happens on this machine, so reaching the host and being
able to log in stay two separate permissions.

### Ctrl-C closes it properly; killing the process does not

Ctrl-C is enough. The plugin handles `SIGINT` by terminating the session, and it
is gone from `describe-sessions` immediately.

**Killing the process is not the same.** `SIGTERM` — `pkill`, `kill <pid>`, a
script cleaning up after itself — closes the local port but leaves the session
**Active** on the AWS side until the 20-minute idle timeout, which is a route to
the database outliving the terminal that opened it. The same applies to anything
that takes the terminal away without an interrupt: a closed window, a dropped
connection, a laptop suspending.

Both behaviours were verified by signalling the plugin directly and watching
`describe-sessions`. If you are ever unsure:

```bash
aws ssm describe-sessions --state Active --query 'Sessions[].SessionId' --output text
aws ssm terminate-session --session-id <id>
```

An empty first line means nothing is open.

### What is recorded, and what is not

CloudTrail logs every `StartSession` with the IAM principal, the target instance
and the document name — who connected, to what, and when.

**The SQL is not recorded anywhere.** A forwarded port carries no terminal
output, so Session Manager never sees the queries and `/aws/ssm/nahuat-sessions`
stays empty for tunnels. That log group captures interactive shells on the
bastion, which is a different and rarer thing. Auditing statements would mean
`pgaudit` or `log_statement` on the database itself.

### Production works the same way

`./infra/scripts/db-tunnel.sh production` — `enable_bastion` is `true` in both
environments, and the same tunnel is how production roles get set and production
data gets inspected.

Gating production off was considered and rejected. It would have guarded against
accident rather than against an attacker, because anyone able to apply that layer
can set the variable themselves; and it would have cost the only practical way to
read production data, since the alternative — a command override on the migrate
task — runs in a `node:24-alpine` image with no `psql` and cannot return rows
through `prisma db execute`.

So reaching production data is an IAM question rather than a network one:
`ssm:StartSession` on the instance, plus `GetSecretValue` on the RDS secret. The
security group has no ingress rules at all, so nothing is reachable without them.
**Guard those permissions accordingly** — they are the whole boundary.

The instance still dies with the application layer, so a torn-down production has
no bastion and the script says so.

### If a bring-up fails on `bastion_sg_id`

The bastion's security group lives in the **foundation** layer, not with the
instance. The RDS group's ingress rules are inline and therefore authoritative,
so a rule added from the application layer would be reverted by the next
foundation apply — and database access would break with nothing in the
application diff to explain it.

The consequence is an apply order: **foundation before application**, and
foundation is applied by hand. `staging-deploy.yml` pins itself to the
application layer, so a bring-up against a foundation that predates the bastion
group fails on a missing `bastion_sg_id` output and takes the whole run with it.

```bash
terraform -chdir=infra/terraform/environments/staging/foundation apply
```

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

A browser login goes to Google and back. The web tier performs the code
exchange; the API verifies the resulting ID token and issues the tokens
everything else uses ([ADR 18](adr/0018-own-authentication-google-only.md)).

```bash
npm run dev --workspace=web    # :3000
npm run dev --workspace=api    # :3001
```

Sign in at `http://localhost:3000/es`. The header shows your name when it works.

**This needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in
`apps/web/.env.local`, and the same client id in `apps/api/.env.local`.** Use a
Google OAuth client dedicated to local development, with exactly one authorized
redirect URI — `http://localhost:3000/auth/callback/google` — and no authorized
JavaScript origins, which are needed only for browser-side OAuth. If the two
files disagree on the id, every sign-in fails the API's audience check.

**Logging in creates your user row.** The `jwt` callback posts Google's ID token
to `POST /auth/session`, which provisions the account from the token's own signed
claims, re-syncs your name and picture, and stamps `lastLoginAt`. You will be a
`USER`: `role` defaults that way and no login path writes it — see below for
promoting yourself.

**This means the API has to be running to sign in.** If it is not, the sign-in
does not half-succeed. An error thrown while establishing the session fails the
login before Auth.js writes a cookie, so you land on `/auth/failed` with no
session at all. That is deliberate — an account is what a sign-in produces, so a
sign-in that cannot produce one is not a sign-in.

**A permanent refusal names itself.** `EMAIL_ALREADY_REGISTERED`,
`USER_DEACTIVATED` and `EMAIL_NOT_VERIFIED` reproduce exactly on retry, so
`/auth/failed` says which one it was; everything else reads "try again", because
from the outside a timeout and an unreachable API are the same thing.

⚠️ **A database carrying pre-2026-08-27 rows will refuse your first sign-in.**
Auth0-era users survive with `provider = GOOGLE` and an `email|…` subject that no
Google account can match, so signing in tries to create a second row and collides
on the unique email. Free the address first, or reset the database:

```bash
docker compose exec -T postgres psql -U nahuat -d nahuat_dev -c \
  "UPDATE users SET email = replace(email, '@', '+legacy@') WHERE subject LIKE 'email|%';"
```

**No consent screen appears for a returning user**, and the account picker only
shows because `prompt: 'select_account'` is set on the provider. Without it,
Google signs a single-account user straight through, which reads as a broken
button to anyone who has just signed out and wants a different account.

**To get a token without a browser**, mint one directly — see the `auth:token`
section below. There is no longer a route that hands you the current session's
token, because the browser never holds one: the tokens live in the encrypted
cookie and are read server-side only.

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

`auth:token` mints a real access token for a seeded user, which is useful for
curl, Postman and scripts. It signs with the same key the API verifies with, so
there is no dev bypass and no second code path — the token is indistinguishable
from one issued by a browser sign-in.

```bash
npm run db:seed:dev                                      # the three dev users
npm run --silent auth:token --workspace=api -- admin     # or contributor | user
```

**It replaces the mock OIDC issuer**, deleted with the move to in-house
authentication (ADR 18). That existed because Auth0's servers cannot reach
`localhost`; Google permits `localhost` redirect URIs, and the API now accepts
only tokens signed by its own key set, so a mock issuer could not produce a
usable token however it were configured.

**The token supplies only the subject, which is `User.id`.** Which rung you get
is whatever the matching row says, so `admin`, `contributor` and `user` select a
seeded user rather than a claim — changing a role in the database takes effect
without minting anything new. The row must exist, so run the seed first.

⚠️ **These tokens are as real as any other**, and the only thing making them
safe is that `JWT_SIGNING_KEYS` is per environment: the local key signs nothing
any deployed environment will accept.
