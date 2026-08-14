# 3. Three Terraform layers, split by destroy safety

- **Status:** Accepted
- **Date:** 2026-08-14 (records a decision taken 2026-08-11)
- **Applies to:** `infra/terraform/`

## Context

Staging exists to be rebuilt. It is created, exercised, and destroyed, and the
cost of running it continuously is not justified by how often it is used.
Production is never destroyed.

A single Terraform root module containing everything makes that impossible to
express: `terraform destroy` is all-or-nothing, and the resources that must
survive a teardown — the hosted zone, the ACM certificate, the container
registry, manually-populated secrets — sit in the same state file as the ones
that should not.

Resource _identity_ is the second half of the problem. Security group IDs,
subnet IDs, and Secrets Manager ARNs are referenced by IAM policies and by other
resources. If a teardown cycle changes them, every dependent policy has to be
rewritten.

## Decision

Three layers, each a separate root module with its own state file, split by how
dangerous it is to destroy them.

| Layer                            | State key            | Destroy | Contains                                                                           |
| -------------------------------- | -------------------- | ------- | ---------------------------------------------------------------------------------- |
| `global`                         | `global/`            | Never   | Route 53 zone, wildcard ACM certificate, ECR repositories, CI IAM roles, SES       |
| `environments/{env}/foundation`  | `{env}/foundation/`  | Never   | VPC, subnets, route tables, security groups, S3 buckets, CloudFront, secret shells |
| `environments/{env}/application` | `{env}/application/` | Freely  | NAT gateway, RDS, ElastiCache, ECS, ALB, ALB DNS record                            |

Dependencies flow one way, read through `terraform_remote_state`: application
reads foundation, foundation reads global. Nothing reads upward.

### What the split decides, beyond ordering

Several placements look arbitrary until read against "what survives a destroy".

**The NAT gateway lives in `application`, not `foundation`.** It is
~$32/month and buys nothing while no tasks are running. Foundation owns the
private _route tables_; the application layer only writes the default route
into them, so the tables and their subnet associations keep stable IDs across
teardown cycles while the billable resource does not.

**Security groups live in `foundation`.** The application layer references
their IDs in ECS network configuration and IAM. Keeping them stable means a
destroy/recreate cycle does not churn dependent resources.

**Secrets are created in `foundation` as empty shells.** The ARNs must be
stable, because the application layer's execution-role policy names them, but
the values are set by hand once per environment and never enter Terraform state.
There is deliberately no database secret at all: RDS uses
`manage_master_user_password`, so AWS generates the password and owns the
secret, keeping it out of state entirely.

**The ALB DNS record lives in `application`.** This is what makes teardown
graceful. CloudFront's origin is the stable hostname `alb-{env}.nahuat.com`
rather than the ALB's own DNS name, so destroying the application layer removes
the record, CloudFront gets a 502, and the maintenance page takes over — with
no CloudFront change in either direction, and no need for foundation to ever
learn the real ALB address. See [ADR 4](0004-cloudfront-origin-and-failover.md).

## Consequences

- Standing up an environment for the first time is an ordered sequence: global,
  then foundation, then populate secrets by hand, then application.
- Destroying staging is a single `terraform destroy` in one directory, with no
  risk of catching anything that matters. Production's expensive resources are
  reachable by the same command, which is why `deletion_protection` and
  `skip_final_snapshot = false` are set there and relaxed in staging.
- A value needed across layers must be an explicit output. This is friction,
  and it is the point — it makes the coupling visible.
- Three state files means three lock scopes, so a staging apply cannot block a
  production one.
- CI's staging role can write only `staging/application/*` in the state bucket.
  The layer boundary and the permission boundary are the same line, which is
  what makes [ADR 1](0001-ci-iam-boundaries.md)'s scoping expressible at all.
- Cost attribution follows the split: the `Layer` tag applied via provider
  `default_tags` shows foundation and global as a flat floor and application as
  the variable cost, which is the number that answers "what does a day of
  staging cost".

## Alternatives considered

**One root module per environment.** Fewer moving parts and no remote-state
reads. Rejected: it makes teardown all-or-nothing, which is the entire problem.

**Terraform workspaces instead of directories.** One configuration, many states.
Rejected because production and staging genuinely differ in more than variable
values — deletion protection, snapshot behaviour, retention, health check
aggression — and workspaces encourage expressing those as conditionals inside
one file, where the production path is never exercised until it matters.

**Two layers, folding global into foundation.** Rejected because the hosted
zone, wildcard certificate, and ECR repositories are shared _between_
environments; duplicating them per environment would mean two certificates for
the same domain and two registries holding the same images.
