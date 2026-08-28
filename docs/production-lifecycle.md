# Production lifecycle (pre-launch)

While production is disposable during pre-launch ([ADR 17](adr/0017-production-disposable-during-prelaunch.md)),
the application layer is torn down between working sessions and stood up for
release rehearsals. This is the runbook for both directions.

Teardown and bring-up are **human** Terraform operations — CI is read-only on
production state ([ADR 1](adr/0001-ci-iam-boundaries.md)). Run them with your own
production credentials, through `infra/scripts/prod-lifecycle.sh`, which operates
on `production/application` only and never on the foundation or global layers.

## Bring up (release rehearsal)

1. Make sure `main` is at the commit you want live, and that its image exists in
   ECR. A push to `main` (or a manual run of the **Production** workflow) always
   builds and pushes `prod-<sha>` — the `images` job needs no infrastructure, so
   it succeeds even while the application layer is down (only the gated `deploy`
   job fails, at "Read outputs").

2. Apply the application layer:

   ```bash
   ./infra/scripts/prod-lifecycle.sh up
   ```

   With no argument this uses `main`'s current commit (`prod-<sha>`); pass a tag
   to pin a specific release. Either way it first checks the image is in ECR —
   erroring with the tags that are available if not — then recreates the ALB,
   both services, RDS, ElastiCache and the NAT gateway pointing at that image.

3. Migrate, seed reference data, roll and verify by running the **Production**
   deploy workflow for that commit (Actions → Production → Run workflow, or
   re-run the run for the merge commit). It now finds the layer, so the gated
   `deploy` job runs migrations, seeds the dialect rows, rolls the services and
   checks readiness. Approve it at the `production` environment gate.

4. Confirm it is live:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://nahuat.com
   curl -sS https://api.nahuat.com/api/health/ready
   ```

## Tear down

**One-time, only if the running database still has deletion protection on.**
Production carried `deletion_protection = true` before the disposable-pre-launch
settings landed (ADR 17). RDS refuses deletion while that is set, and a `destroy`
cannot flip it in the same pass — the attribute has to be changed on the live
instance first. So the first teardown of an already-running production needs one
apply to disable it:

```bash
terraform -chdir=infra/terraform/environments/production/application apply \
  -var "image_tag=prod-$(git rev-parse origin/main)"
```

The tfvars now set `deletion_protection = false` and `skip_final_snapshot = true`,
so this apply clears the lock (a non-disruptive attribute change, applied
immediately). After it, every bring-up carries those settings, so subsequent
teardowns need no unlock step.

Then:

```bash
./infra/scripts/prod-lifecycle.sh down
```

The script requires typing `destroy production` to proceed, then destroys the
application layer. `nahuat.com` fails over to the maintenance page
([ADR 4](adr/0004-cloudfront-origin-and-failover.md)); `api.nahuat.com` becomes
unreachable, which is expected. Confirm:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://nahuat.com   # maintenance page, still 200
```

## Notes

- **The database is destroyed with the layer.** Acceptable only pre-launch:
  reference data is re-seeded on the next bring-up, there is no authored dictionary
  content, and user rows are Google identities recreated on login. The first real
  content or user base ends this posture — see
  [ADR 17](adr/0017-production-disposable-during-prelaunch.md).
- **Foundation and global are never destroyed.** The script refuses any target but
  `production/application`. The domain, TLS, the maintenance page, the assets
  bucket and the Terraform state all live below the application layer and survive
  every teardown.
- **Bring-up is minutes, not seconds** — a cold apply recreates RDS and the ALB
  before the deploy workflow migrates and rolls. Expected for a rehearsal.
