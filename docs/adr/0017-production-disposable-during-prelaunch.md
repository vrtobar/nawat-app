# 17. Production is disposable during pre-launch

- **Status:** Accepted
- **Date:** 2026-08-22
- **Applies to:** `infra/terraform/environments/production/application/`,
  `infra/scripts/prod-lifecycle.sh`, `docs/production-lifecycle.md`
- **Depends on:** [ADR 3](0003-terraform-layer-split.md) for the layer split
  this relies on, [ADR 4](0004-cloudfront-origin-and-failover.md) for what the
  domain serves while the application layer is gone, [ADR 1](0001-ci-iam-boundaries.md)
  for why teardown stays human

## Context

Production runs the full application layer around the clock: an ALB, two Fargate
services, an RDS instance, an ElastiCache node, and a NAT gateway (see
[ADR 3](0003-terraform-layer-split.md) for how these are grouped). During
pre-launch there are no users and no authored content — all Nawat vocabulary is
entered through the admin panel once it exists — so the always-on cost of that
layer buys nothing. The bulk of the spend is in resources that a stopped service
does not release: the ALB, RDS, ElastiCache, and the NAT gateway bill whether or
not a task is running.

Two pieces of machinery to run without a live application layer already exist and
were built deliberately:

- The Terraform layer split ([ADR 3](0003-terraform-layer-split.md)) isolates the
  disposable **application** layer from the **foundation** layer, which is never
  destroyed. Destroying the application layer is a supported, bounded operation.
- The CloudFront origin-group failover ([ADR 4](0004-cloudfront-origin-and-failover.md))
  makes `nahuat.com` serve the maintenance page when the ALB is unreachable —
  "the expected case of the application layer being destroyed," in that ADR's
  words. Tearing the layer down does not produce a dead domain.

What was missing was the decision to actually use them, and a bounded, repeatable
way to do so that does not weaken the CI security boundary in
[ADR 1](0001-ci-iam-boundaries.md).

## Decision

During pre-launch, the production **application** layer is treated as disposable.
It is torn down between development and testing windows and stood up again for
release rehearsals.

- **Teardown and bring-up are human `terraform` operations** against
  `production/application` **only** — never `foundation`, never the global layer.
  A guard script (`infra/scripts/prod-lifecycle.sh`) refuses any other target and
  requires an explicit confirmation to destroy; the sequence is documented in
  `docs/production-lifecycle.md`.
- **CI stays read-only on production state.** [ADR 1](0001-ci-iam-boundaries.md)
  is unchanged: `deploy-production.yml` still only promotes images onto an
  already-applied layer and cannot write or destroy state. The convenience of a
  one-click teardown was rejected precisely because it would require giving CI
  apply/destroy rights on production — a boundary worth more than the convenience,
  and for an operation run at most a few times a week.
- **`develop → main` merges remain the release log.** Each release is a rehearsal:
  bring the layer up, let the (gated) deploy workflow migrate, seed reference data,
  roll and verify, exercise it, then tear it down. This keeps the deploy pipeline
  from bit-rotting (expired config, provider drift) and keeps
  `git log --first-parent main` an accurate record of what was released.

## Consequences

- The public domain stays reachable while production is down: `nahuat.com` fails
  over to the maintenance page ([ADR 4](0004-cloudfront-origin-and-failover.md)).
  `api.nahuat.com` is unreachable while down, which is expected — nothing consumes
  it in that state.
- The production database lives in the application layer, so teardown destroys it.
  This is acceptable **only** pre-launch: reference data (the dialect rows) is
  re-seeded by the deploy workflow on every bring-up, there is no authored
  dictionary content, and the user rows that exist are Auth0 identities synced on
  login — Auth0 is their source of truth, so a login recreates them and nothing
  durable is lost. To let the layer actually be destroyed, production sets
  `deletion_protection = false` and `skip_final_snapshot = true` for this window
  (see `terraform.tfvars`); both revert at launch.
- Bring-up is not instant. A cold apply recreates RDS, the ALB, and the services,
  then the deploy workflow migrates and rolls — minutes, not seconds. Acceptable
  for a rehearsal; it is the reason this is a pre-launch posture, not a permanent
  one.

## This ends at launch

The first real Nawat content authored in production, or the first real user base,
makes the application layer non-disposable — its database can no longer be thrown
away. At that point this decision is superseded: `deletion_protection` and
`skip_final_snapshot` revert to their protected values, production returns to the
always-on, never-torn-down posture the deploy workflow already assumes, and this
ADR is marked accordingly. Nothing here changes the foundation layer, which is
never destroyed in any posture.

## Alternatives considered

- **Keep production running 24/7.** Rejected for pre-launch: it pays the full
  always-on cost for an environment with no users and nothing to serve but a
  pre-dictionary state.
- **CI-managed up/down, like staging, gated on the production reviewer.** Rejected:
  it requires a new production role with apply and destroy rights on the
  application layer, reversing the read-only-CI boundary in
  [ADR 1](0001-ci-iam-boundaries.md) for a gain that is small and infrequent. The
  boundary's value — a compromised pipeline cannot rewrite or destroy production —
  outweighs a button.
- **Scale the services to zero instead of destroying the layer.** Rejected: it
  frees only the Fargate task cost. The ALB, RDS, ElastiCache, and NAT gateway
  keep billing, and those are the majority of the spend. Destroying the layer is
  what actually removes the cost.
