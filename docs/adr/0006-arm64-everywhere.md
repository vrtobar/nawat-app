# 6. ARM64 (Graviton) across the whole stack

- **Status:** Accepted
- **Date:** 2026-08-14 (records a decision taken 2026-08-12)
- **Applies to:** `infra/terraform/modules/{database,cache,compute}/`, `apps/*/Dockerfile`

## Context

Every compute and managed-data resource in this project has an x86 and an ARM
variant. AWS prices the ARM (Graviton) variants lower for identical published
specifications, and this is a personal project where the monthly bill is a real
constraint.

The question is not whether ARM is cheaper — it is — but whether anything in
the stack forces x86.

Nothing does. The runtime is Node.js, the database and cache are AWS-managed,
and the base images (`node:*-alpine`, `postgres`, `redis`) all publish
`linux/arm64`. There are no native dependencies compiled for a specific
architecture; notably Prisma 7 drops the Rust query engine binary, which was
historically the most likely thing to lack an ARM build
([ADR 7](0007-database-connectivity-and-migrations.md)).

## Decision

ARM64 everywhere:

| Resource           | Choice                       | Saving vs x86 equivalent |
| ------------------ | ---------------------------- | ------------------------ |
| RDS PostgreSQL     | `db.t4g.micro`               | ~11%                     |
| ElastiCache Valkey | `cache.t4g.micro`            | ~6%                      |
| ECS Fargate tasks  | `cpu_architecture = "ARM64"` | ~20% on Fargate rates    |
| Container images   | `--platform linux/arm64`     | n/a                      |

## The coupling this creates

The task definition's `runtime_platform.cpu_architecture` and the image's build
platform are **one decision expressed in two places**, and they are not
validated against each other. A mismatch produces tasks that fail to start with
an opaque exec-format error — no mention of architecture, nothing pointing at
the cause.

Both sites carry a comment saying so. Any change to one requires the other.

This extends to CI: GitHub's standard `ubuntu-latest` runners are x86, so image
builds must either run on ARM runners or emulate. Native ARM runners are the
right answer where available; QEMU emulation works but slows `npm install` and
`next build` substantially.

## Consequences

- Local development on an Apple Silicon Mac builds the same architecture that
  production runs, which removes a class of "works locally" difference rather
  than adding one. On an x86 development machine the position reverses.
- Any future dependency with a native component must publish an ARM build.
  Checking this is now part of evaluating a dependency.
- The savings are proportional, not fixed, so they scale with the stack rather
  than being a one-off.

## Alternatives considered

**x86 throughout.** Marginally wider compatibility, more expensive on every
line item, and it would have introduced an architecture difference against the
development machine.

**Mixed — ARM for managed services, x86 for containers.** The managed-service
saving with none of the image-build coupling. Rejected because the coupling is
a one-line setting with a comment, and Fargate is where the largest proportional
saving is.
