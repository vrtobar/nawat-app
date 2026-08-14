# 1. CI/CD IAM boundaries

- **Status:** Accepted
- **Date:** 2026-08-14
- **Applies to:** `infra/terraform/global/main.tf`

## Context

GitHub Actions needs AWS credentials to build images, apply the staging
application layer, and deploy to production. Federation is via OIDC, so no
access keys are stored in GitHub and there is nothing to leak or rotate. The
open question is not _how_ CI authenticates but _what each identity may do once
it has_.

Three properties of the setup shape the answer:

1. **Staging deploys are automatic and unreviewed.** Any push to `develop`
   obtains staging credentials. There is no approval step, by design — that is
   what makes staging useful.
2. **Production deploys are gated** by a GitHub Environment requiring manual
   approval, and the production role's trust policy names
   `repo:<repo>:environment:production` rather than a branch. A rejected
   approval means no token is ever issued.
3. **Staging's role must run `terraform apply`,** because the staging
   application layer is created and destroyed on demand. Production's does not:
   production infrastructure is applied by a human with their own credentials.

## Decision

Three roles, each with one job.

| Role                               | Trusted subject                 | May do                                                                                 |
| ---------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `nahuat-github-actions-build`      | `ref:refs/heads/{develop,main}` | Push to two ECR repositories                                                           |
| `nahuat-github-actions-staging`    | `ref:refs/heads/develop`        | `terraform apply` the staging application layer                                        |
| `nahuat-github-actions-production` | `environment:production`        | Register task definitions, update services, run the migration task, update Lambda code |

Production holds no create or delete rights on infrastructure, no Terraform
state write, and no secrets access.

### Why build is separate

Originally the staging role held ECR push for both environments, and
production's build job assumed it. That put the artifact production runs in the
hands of an identity obtained by any push to `develop`, carrying `rds:*`,
`ecs:*` and `lambda:*` on `Resource: "*"` that a build has no use for. The
production approval gate then covered the _promotion_ but not the _thing being
promoted_.

It also meant staging's trust policy had to list `refs/heads/main` purely so
production could borrow it — staging's security boundary encoding a fact about
production's pipeline.

The build role can write two repositories and nothing else.

### Why service-level wildcards in staging

`StagingTerraform` grants `rds:*`, `ecs:*`, `elasticache:*` and similar rather
than enumerating actions. Action-level allow-lists break on every Terraform
provider upgrade, when a new API call appears in a resource's create path. The
failure is an `AccessDenied` in the middle of an apply, which is the worst place
to discover a missing permission.

The containment therefore comes from the Deny blocks, not from the Allow list.
Narrowing these wildcards is deferred until the infrastructure stops changing
shape; see the backlog.

## The Deny blocks

Explicit `Deny` overrides every `Allow`, including the service wildcards, so
these are the real boundary. Each is recorded here with the escalation it
closes and whether that escalation was reachable at the time of writing.

### `DenyProductionResources`

**Closes:** staging automation reaching production.

`StagingTerraform` grants compute and data-service wildcards on `Resource: "*"`.
Without this block, a workflow triggered by a push to `develop` could delete the
production database or push a deployment onto production services. The
production environment's approval gate would then be decorative: it gates the
production _role_ while an ungated role holds equivalent power over the same
resources.

**Reachable when written (2026-08-13)** for RDS, ECS, ElastiCache, Lambda and
SQS. The state-file and Secrets Manager ARNs in the block are defence in depth —
`ReadStagingAndGlobalState` and `StagingSecrets` are already prefix-scoped, so
those paths are shut; the Deny keeps them shut if either statement is widened
later.

**Known gap:** the block lists no EC2 ARNs. Route tables and NAT gateways are
instead protected by a tag condition on the Allow side
(`ec2:ResourceTag/Environment = staging`), because the application layer owns
the NAT gateway while the _foundation_ layer owns the route tables it writes
into. Without that condition the staging role could write a default route into
production's private route tables and redirect all production egress.

### `DenyIamUserManagement`

**Closes:** converting temporary CI credentials into permanent ones.

The escalation is `iam:CreateUser` → `iam:AttachUserPolicy` (AdministratorAccess)
→ `iam:CreateAccessKey`, yielding long-lived keys that outlive the one-hour OIDC
session, survive rotation of everything else, and are not bounded by region.
Nothing in this architecture uses IAM users, so denying the whole surface costs
nothing.

**Not reachable when written** — no Allow grants user, group, or access-key
actions. This is the backstop that keeps it that way.

It matters because the obvious guard does not work. **`aws:RequestedRegion`
cannot constrain IAM.** IAM's endpoint lives in `us-east-1`, so a `us-east-1`
region condition _admits_ IAM calls rather than blocking them. That is why the
IAM Allow statements are scoped by ARN prefix instead of by region, and why a
future "simplification" that replaces prefix scoping with a region condition
would silently open the entire surface.

### `DenyCicdSelfModification`

**Closes:** the CI roles rewriting their own permissions, and staging unlocking
production by editing production's trust policy.

This is the sharpest hole in the design, and it exists because of a name
collision. `StagingServiceRoles` allows `iam:PutRolePolicy`,
`iam:AttachRolePolicy` and `iam:UpdateAssumeRolePolicy` across `role/nahuat-*`,
and all three CI roles are named `nahuat-github-actions-*`. Two escalations
follow:

1. `iam:PutRolePolicy` on its own role → attach `Action: "*"` → every
   restriction becomes self-removable, making the least-privilege split
   worthless.
2. `iam:UpdateAssumeRolePolicy` on `nahuat-github-actions-production` → widen
   its trust to any branch → assume the production role with no environment
   approval, bypassing the gate entirely.

`StagingServicePolicies` opens the same door via `iam:CreatePolicyVersion` on
`policy/nahuat-*`. The OIDC provider is included in the block because editing
its thumbprint or client IDs subverts the federation all three roles depend on.

**Reachable when written, and the reason this block is not optional.**

## Consequences

- Adding a new resource type to the staging application layer fails with
  `AccessDenied` until its service prefix is added to `StagingTerraform`. This
  is intended: a loud, localized failure in staging beats a role that quietly
  grows toward administrator.
- The `nahuat-github-actions-*` naming convention is load-bearing.
  `DenyCicdSelfModification` matches on that prefix, so a CI role named outside
  it would silently fall outside the protection.
- ARNs inside `DenyCicdSelfModification` are written as literal strings rather
  than resource references, because the roles and policies consume the policy
  document — referencing them creates a dependency cycle.
- IAM role _descriptions_ reject the em dash (U+2014) and other non-Latin-1
  characters; `CreateRole` fails with a 400. IAM _policy_ descriptions accept
  it. IAM policy descriptions are also write-once — changing one forces
  Terraform to replace the policy, briefly detaching it from its role.
- Three roles means three GitHub repository variables to keep in sync.

## Alternatives considered

**One role for all of CI.** Simplest to operate, and wrong: a single identity
with staging apply rights plus production deploy rights makes the production
approval gate meaningless, since the same power is reachable without it.

**Two roles, with production borrowing staging's ECR access.** What existed
before this decision. Rejected for the reasons in _Why build is separate_.

**Action-level allow-lists instead of service wildcards.** Genuinely tighter,
but breaks on provider upgrades and fails mid-apply. Deferred rather than
rejected — worth revisiting once the infrastructure stabilizes.

**IAM permissions boundary on CI-created roles.** The staging role can create
roles under `nahuat-*` and `PassRole` them to ECS tasks; a sufficiently
privileged created role is an escalation path. A boundary policy caps what any
CI-created role can do regardless of its attached policies. Deferred: it needs a
carefully scoped boundary, and exploiting the gap requires an attacker who
already controls `develop`.
