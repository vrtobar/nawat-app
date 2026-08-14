# 2. Immutable image tags, and who owns a task definition

- **Status:** Accepted
- **Date:** 2026-08-14
- **Applies to:** `infra/terraform/modules/compute/`, `infra/terraform/global/main.tf`

## Context

ECS task definitions must name a container image. The original design pinned
`:latest` in Terraform and had CI ship code with
`aws ecs update-service --force-new-deployment`, which re-pulls the same tag
against the same task definition revision.

That works, in the sense that new code reaches production. It fails in three
ways that only matter when something goes wrong.

**Rollback requires mutating the registry.** Every revision names `:latest`, so
no revision is distinguishable from any other. Recovering from a bad deploy
means re-tagging `latest` in ECR to point at the previous image — a registry
mutation standing in for a deployment, which races with concurrent pushes and
leaves no record.

**Nothing records what is running.** `describe-services` reports a revision
number; the revision reports `:latest`. There is no path from a running task
back to a commit.

**It defeats the deployment circuit breaker.** `deployment_circuit_breaker`
with `rollback = true` reverts to the previous task definition revision — which
also names `:latest`, and therefore the image that just failed. The safety net
cannot catch the failure it exists for.

There is a quieter fourth problem: a task replaced between deploys — by
autoscaling, or by ECS rescheduling onto new capacity — pulls whatever
`:latest` points at *then*. Two tasks in one service can silently run different
code.

## Decision

**Immutable tags, and a split of ownership between Terraform and CI.**

Images are tagged `prod-{sha}` and `staging-{sha}` with the full 40-character
commit SHA. `:latest` is no longer pushed.

Terraform owns the task definition **shape** — environment variables, secrets,
CPU and memory, runtime platform, logging. CI owns the **image**. On each
deploy the workflow:

1. describes the newest revision of the family,
2. substitutes only the image tag,
3. registers the result,
4. points the service at the new revision.

Terraform changes still reach production, because CI copies from whatever
revision Terraform last wrote. Rollback becomes a single `update-service` call
naming an older revision, with no registry mutation at all.

### ECR repositories are `IMMUTABLE`

Task definitions name a *tag*, not a digest. Under a mutable tag the bytes
behind an already-deployed release can change after the fact: repointing
`prod-{sha}` at different content means ECS pulls the new content on the next
task placement, with no deployment and nothing in the service history to show
for it.

Immutability makes a tag a permanent name for one manifest. It is also what
makes the circuit breaker's rollback land on a genuinely different image.

This does security work beyond deployment hygiene. The build role
([ADR 1](0001-ci-iam-boundaries.md)) is obtained by any push to `develop`.
Under mutable tags it could overwrite an image production had already deployed.
Under immutable tags the same access can only claim an unused tag, which makes
the next legitimate push fail loudly rather than succeed wrongly.

### `ignore_changes = [task_definition]` is part of the same decision

Once CI owns the revision pointer, Terraform must stop reverting it, so both
`aws_ecs_service` resources ignore `task_definition` (alongside
`desired_count`, which autoscaling owns).

**These two changes are only correct together.** Under a floating tag CI never
changes the revision, so ignoring `task_definition` would mean Terraform's
environment, secret, and sizing changes register new revisions that the service
silently never adopts — changes that appear to apply successfully and never
take effect. This was briefly the state of the repository in August 2026 and is
why `ignore_changes` was removed at the time.

The precondition is enforced in code: `var.image_tag` has a validation block
rejecting anything that is not `prod-<40 hex>` or `staging-<40 hex>`. A future
edit reintroducing a floating tag fails at plan time rather than stranding
every subsequent Terraform change.

### The migration task is the exception

The migration task definition has no service, so nothing ignores its revision
and nothing updates it on deploy. CI must register its own copy with the new
image and run **that revision by ARN**.

Running the family name instead would execute whatever image Terraform last
wrote — migrating the database with the previous release's code, immediately
before rolling out the new one.

### `image_tag` in Terraform is not what is running

Because the services ignore Terraform's revision, the tag in
`terraform.tfvars` only takes effect when an environment is built from nothing.
It is the **disaster-recovery floor**: the release a from-scratch apply comes up
on. It is bumped when that floor should move, not on every deploy.

Staging is different — it is created and destroyed by its own workflow, which
passes the tag it just built, so staging's `image_tag` has no default and a
missing value fails the plan.

## Consequences

- Rollback is `update-service` against a prior revision. No ECR mutation, no
  rebuild.
- Every running task is traceable to a commit through its task definition.
- The circuit breaker works as intended.
- Production's `terraform.tfvars` carries a tag that is *not* the running
  version, which is confusing without the comment that explains it. This is the
  main cost of the design.
- Terraform and CI both register revisions into the same family, so the family
  accumulates revisions from two sources. Harmless — ECS keeps them all and CI
  always copies the newest.
- Image builds must pass `--provenance=false --sbom=false`. buildx otherwise
  emits an OCI *image index* whose children are pushed untagged, and the ECR
  lifecycle rule expiring untagged images after one day would delete them out
  from under the live tag — pulls begin failing roughly 24 hours after a deploy
  with no code change to blame. Observed on the first manual push, 2026-08-13.

## Alternatives considered

**Pin digests instead of tags.** Strictly stronger: a digest is the content
address, so immutability is intrinsic rather than a registry setting. Rejected
because digests are unreadable in the console and in `describe-services` output,
and `prod-{sha}` under an `IMMUTABLE` repository already guarantees one tag maps
to one manifest. Worth revisiting if supply-chain verification becomes a
requirement.

**Keep `:latest` alongside `prod-{sha}`.** Convenient for manual `docker pull`.
Rejected because it forces the repository to stay `MUTABLE`, which is the
setting that makes the whole guarantee conditional.

**Let Terraform own the image too, applying on every deploy.** Conceptually
cleaner — one system owns the resource. Rejected because it puts a full
`terraform apply` on the deploy path, which requires giving the production role
create and delete rights across the infrastructure. The current split exists
precisely so the production role can deploy without being able to alter
infrastructure.

**Have CI use `--force-new-deployment` against a Terraform-registered
revision.** The status quo being replaced. It is the only option that requires
no coordination between the two systems, which is why it was attractive, and
every problem in *Context* follows from it.
