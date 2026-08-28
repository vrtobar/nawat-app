# 11. Polyglot queue consumers, packaged as container images

- **Status:** Accepted; the set of consumers it describes is superseded by
  [ADR 19](0019-asynchronous-tier-anchored-on-media-processing.md), which deletes
  three of the four and anchors the tier on media processing. The language and
  packaging decisions below stand, and ADR 19 gives them the technical
  justification this record says they lacked.
- **Date:** 2026-08-16
- **Applies to:** `apps/workers/`, `infra/terraform/global/main.tf`, and the
  unbuilt `modules/messaging`

## Context

Four SQS consumers exist: `cache-invalidation-consumer`,
`cdn-invalidation-consumer`, `audit-consumer`, and
`lesson-completion-consumer`. All four are TypeScript, all four are npm
workspaces under `apps/workers/*`, and all four are stubs — each one's
`processRecord` ends in `throw new Error('not implemented')`. None is deployed:
there is no `modules/messaging`, no SQS queue, and no Lambda function in any
environment.

Note that this record describes none of that code. It predates the
implementation entirely, and is the shape the four consumers will be built to
rather than a description of anything running.

Two questions arrived together and are recorded together because each
constrains the other: what language these run in, and how the artifact reaches
Lambda.

The language question has an origin worth stating, because the reasoning does
not make sense without it. **No defect prompted it.** Nothing about the
TypeScript stubs is wrong, no consumer was failing, and no requirement forced a
second language. It came from a deliberate choice to have Python in the stack,
for reasons outside the code. The question that actually needed answering was
therefore not "should some workers be Python" but "how much of this codebase
should change to accommodate that," and the interesting part of the answer is
what was refused.

## Decision

**Infrastructure glue is Python. Code that owns domain state stays TypeScript.
The line is coupling, not component type.**

| Consumer                      | Language   | What it touches                         |
| ----------------------------- | ---------- | --------------------------------------- |
| `cache-invalidation-consumer` | Python     | Valkey/Redis keys                       |
| `cdn-invalidation-consumer`   | Python     | CloudFront `CreateInvalidation`         |
| `audit-consumer`              | Python     | one `INSERT` into `audit_logs`          |
| `lesson-completion-consumer`  | TypeScript | the Prisma schema and the SRS scheduler |

The two invalidation consumers are uncontroversial — neither reads the
database, so neither has any relationship with the schema.

**`audit-consumer` is the case that decides the rule.** It writes to Postgres,
so a rule drawn on component type — "anything touching the database is
TypeScript" — would keep it. Coupling says otherwise. It appends a row with a
fixed shape and takes its idempotency from `AuditLog.sqsMessageId @unique`; it
never reads the model, never joins, and never depends on a field it did not
write. `import { prisma } from '@nahuat/database'` currently buys a generated
client for what is one `INSERT ... ON CONFLICT DO NOTHING`. Raw `psycopg` with
literal SQL is the honest description of that job.

**`lesson-completion-consumer` is the opposite case, and it stays.** It reads
`LessonVocabulary`, upserts `UserCardProgress` on the compound unique key, and
seeds each new card with FSRS defaults. In Python it would need a duplicated
schema layer and a second FSRS implementation, with the `ts-fsrs` defaults
re-derived by hand. A divergence between two FSRS implementations does not
throw — it silently schedules reviews wrongly, and the symptom is a learning
system that feels subtly off months later.

### Packaging: container images, not zip

Not because container images are intrinsically better for Lambda. They are
chosen because the container pipeline already exists and works, and the zip
pipeline does not exist at all:

- ECR with `image_tag_mutability = "IMMUTABLE"` ([ADR 2](0002-immutable-image-tags.md))
- ARM64 end to end ([ADR 6](0006-arm64-everywhere.md)); Lambda's arm64 is also
  priced below x86 per millisecond, so the existing choice carries over intact
- buildx in CI, including the `provenance: false` / `sbom: false` fix
- ECR lifecycle policies capping storage
- `lambda:UpdateFunctionCode`, `lambda:GetFunction` and `lambda:PublishVersion`
  already granted to the production role on
  `function:nahuat-production-*` — `infra/terraform/global/main.tf:405`

Zip needs a new artifact bucket, a packaging step, `source_code_hash` handling
and extra S3 permissions. That is a second deployment pipeline standing beside
a working one, maintained for four functions.

Containers also preserve a property the project already relies on: **every
running thing in production, ECS task or Lambda, is identified by an immutable
`prod-{sha}` tag naming the commit that produced it.** Under zip, Lambda
versions would be identified by a hash of a bundle instead, and the "what is
running right now" question would have two different answers depending on which
compute you asked about.

The cost is cold start. A container image is a few hundred megabytes against a
~15MB zip, which is a few hundred milliseconds on a cold invocation. That is
irrelevant here: all four are asynchronous SQS consumers with nobody waiting on
the response. **The answer would flip for a user-facing Lambda behind API
Gateway**, and this record should not be cited for one.

## Consequences

- **Four ECR repositories do not exist.** `global/main.tf` defines
  `nahuat-api` and `nahuat-web` only, each with a lifecycle policy, and the
  build role's ECR push grant names those two ARNs explicitly
  (`main.tf:451`). Every one of those has to be extended before a worker image
  can be pushed. Mechanical, but silent if forgotten — the failure is a denied
  push in CI, not a plan-time error.
- **The `provenance: false` / `sbom: false` fix is load-bearing here too.** The
  lifecycle rule expiring untagged images after one day would delete the
  children of an image index out from under a live function exactly as it would
  for an ECS service, roughly a day after deploy, with no code change to blame.
- **CI does not know Python, and its filters actively mislead.** `ci.yml`'s
  `node` filter matches `apps/**`, so a Python-only change under
  `apps/workers/` will trigger lint, typecheck and unit tests that have nothing
  to say about it — and report success. There is no ruff or pytest job. The
  `docker` filter is `apps/*/Dockerfile`, a single path segment, so
  `apps/workers/*/Dockerfile` matches nothing at all.
- **The three Python workers must leave npm workspaces.** The root
  `package.json` lists `apps/workers/*`, so turbo will otherwise try to build
  and lint directories with no `package.json`.
- **SQS message shapes now cross a language boundary**, which is precisely the
  two-definitions problem [ADR 10](0010-zod-as-the-payload-contract.md) exists
  to prevent. The intended answer is the same one: generate the Python-side
  schema from the Zod definition via `z.toJSONSchema()` rather than transcribe
  it. Where that generated artifact lives, and what regenerates it, is
  unresolved.
- **`audit-consumer` gains a dependency it cannot see.** Its idempotency comes
  from a unique constraint declared in `schema.prisma` and created by a Prisma
  migration. In Python that constraint is invisible — no generated client, no
  type, nothing that breaks if the column is renamed. It becomes another
  instance of the ownership split recorded in
  [ADR 12](0012-migration-composition-and-index-ownership.md): the schema is
  authored in one place and depended on from somewhere that cannot check it.
- **Deferred work that assumed zip packaging is now built on a dead premise** —
  notably the SES inbound forwarder Lambda, which was postponed until Lambda
  packaging was settled, on the assumption that settling it meant zip. It is
  settled and it is not zip. That forwarder is also the one Lambda worth
  reconsidering on its own merits: it shares nothing with these four consumers,
  so it would need an image and a repository of its own.
- **Two languages in one repository is the ongoing cost:** two dependency
  update surfaces, two lint configurations, two test runners, and a reviewer
  who has to be fluent in both. Nothing technical requires paying it, and that
  is worth stating plainly rather than retrofitting an engineering
  justification onto a choice made for other reasons.
- Doing this while all four consumers are stubs is what makes it cheap. Every
  line written into them first is a line that has to be ported.

## Alternatives considered

**Rewrite the whole backend in Python.** The version of this question that was
actually asked first, and the one it was most important to reject. It would
destroy `packages/shared`: one Zod schema currently defines each payload for
the API and — by design, once the web app consumes it — the frontend, and
splitting the language makes that two hand-synchronised definitions in two
languages. That is the exact drift problem cleaned up on 2026-08-15 and
recorded in [ADR 10](0010-zod-as-the-payload-contract.md), reintroduced
deliberately. It would also aim at the wrong target: the infrastructure and
operational work in this repository — the Terraform layering, the CI/CD
boundaries, the reliability decisions — is not written in the application
language, so changing that language moves none of it.

**Keep all four consumers in TypeScript.** The status quo, and free. The
technical case here is close to neutral and it is worth saying so — the two
invalidation consumers are small enough in either language that neither choice
is wrong. It was rejected for the reason recorded in Context rather than
because TypeScript would have failed — which is exactly why the rule was drawn
on coupling: a boundary with a technical meaning survives the motive that
introduced it.

**All four in Python.** Rejected for `lesson-completion-consumer` alone, on the
duplicated-schema and second-FSRS-implementation grounds above.

**Zip packaging.** Rejected as a second deployment pipeline beside a working
one, and because it fragments the `prod-{sha}` identity property across
compute types.
