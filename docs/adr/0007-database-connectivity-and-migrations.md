# 7. Database connectivity and migration execution

- **Status:** Accepted
- **Date:** 2026-08-14 (records decisions taken 2026-08-11 through 2026-08-13)
- **Applies to:** `packages/database/`, `infra/terraform/modules/compute/task-definitions.tf`

## Context

The same Prisma client serves local development, ECS tasks, and (later) Lambda
consumers. Those environments differ in how credentials arrive, in whether TLS
is required, and in who is allowed to change the schema.

Three constraints came from outside and shaped the rest.

**Prisma 7 removed `datasource.url` from `schema.prisma`** and dropped the Rust
query engine. Connection configuration moved to a driver adapter in application
code plus a `prisma.config.ts` for the CLI.

**The AWS-managed RDS secret contains only `username` and `password`** — not
host, port, or database name, contrary to the six-key structure assumed while
planning. This was verified against the live secret.

**RDS ships with `rds.force_ssl = 1`.** An unencrypted connection is refused
outright with `no pg_hba.conf entry ... no encryption`, which is what the first
ECS task hit.

## Decision

### One entry point, two connection shapes

`buildDatabaseUrl()` in `@nahuat/database` resolves in order:

1. `DATABASE_URL` if set — local development and integration tests.
2. Otherwise assemble from `DB_USERNAME`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`,
   `DB_NAME`, URL-encoding the credentials because AWS-generated passwords can
   contain reserved characters.

This mirrors how the credentials actually arrive. In ECS the two secret values
come from the AWS-managed secret via `valueFrom`, while host, port and name are
plain environment variables from the data layer's Terraform outputs — they are
not sensitive and do not belong in a secret.

TLS is appended only on the assembled branch, as `sslmode=no-verify`. Local
Postgres has no TLS at all, and forcing it there would break development.

### The CLI is configured separately from the application

`prisma.config.ts` exists for `migrate`, `studio`, and `db seed`. Application
code never reads it; it connects through the driver adapter instead.

It uses `process.env.DATABASE_URL` rather than Prisma's `env()` helper, because
`env()` throws when the variable is unset at config-load time — which would
break `prisma generate`, a command that needs no database connection at all.

### Migrations run as a one-off ECS task

A dedicated `migrate` task definition shares the API's image, overrides the
command, and has no service. The deploy workflow runs it and waits before
rolling the services.

Running migrations at application startup instead would let several tasks race
each other, and relying on Prisma's advisory lock to arbitrate that is fragile
under a rolling deployment where old and new tasks overlap.

Sharing the API image means the migration provably runs the same code as the
service. The cost is that `prisma`, `tsx`, and `dotenv` ship as runtime
dependencies, which is most of why the API image is 828MB against the web
image's 312MB.

Because the migration task has no service, nothing ignores its revision, so CI
must register its own revision and run **that ARN** — see
[ADR 2](0002-immutable-image-tags.md).

## Consequences

- `apps/api/src/env-bootstrap.ts` must remain the first import in `main.ts`.
  `@nahuat/database` builds its client at import time, so environment files have
  to be loaded before that module is reached.
- Migrations run before the new code does, so every migration must be
  backward-compatible with the release currently serving traffic. Expand and
  contract across two deploys, never rename in one.
- A failed migration fails the deploy before any task rolls, which is the
  intended ordering.
- Migration logs go to a separate log group with 7-day retention regardless of
  the environment's setting: the output is only ever read when a deploy fails.

## Known gap

`sslmode=no-verify` encrypts but does not validate the server certificate, so
it defends against passive eavesdropping and not against an in-VPC
man-in-the-middle. Low risk — the database is unreachable outside the VPC and
accepts connections from two security groups — but it is not the strong form.

Moving to `verify-full` requires shipping the Amazon RDS CA bundle in the API
and worker images. The bundle expires on AWS's rotation schedule, so a
`verify-full` deployment nobody maintains fails closed at the worst possible
moment. Tracked in the backlog, to be done before real user data exists.

## Alternatives considered

**Put the full `DATABASE_URL` in Secrets Manager.** One value, no assembly.
Rejected because RDS's `manage_master_user_password` owns its own secret and
rotates the password; a hand-maintained URL alongside it would drift out of
sync on the first rotation.

**Run migrations at container startup.** No orchestration needed. Rejected for
the race between concurrently starting tasks.

**A separate, smaller migration image.** Would cut the API image substantially.
Rejected for now because one artifact guarantees the migration runs the same
code as the service; revisit if image pull time affects deploy speed.
