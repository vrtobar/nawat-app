# 4. CloudFront origin, TLS, and the maintenance page

- **Status:** Accepted
- **Date:** 2026-08-14 (records decisions taken 2026-08-12 and 2026-08-13)
- **Applies to:** `infra/terraform/environments/*/foundation/main.tf`

## Context

`nahuat.com` is served by CloudFront in front of an ALB running a
server-rendered Next.js application. Two requirements shaped the configuration,
and both produced outages before they produced decisions.

1. The application layer is destroyed routinely in staging. Something has to
   answer requests while it is gone, and it must not require a CloudFront change
   in either direction — CloudFront distributions take minutes to propagate.
2. The origin is SSR, not a static bucket. Responses are user-specific,
   requests include `POST`, `PUT`, `PATCH` and `DELETE` for Server Actions and
   form posts, and there is no `index.html` anywhere.

Almost every default that a CloudFront tutorial suggests is written for the
static-bucket case and is actively wrong here.

## Decision

### The origin is a stable hostname the application layer owns

CloudFront points at `alb-{env}.nahuat.com`, not at the ALB's generated DNS
name. The application layer creates that Route 53 record alongside the ALB.

Destroying the application layer removes the record, CloudFront can no longer
resolve its origin, and the failover below engages. Foundation never learns the
real ALB address, and no CloudFront update is involved in either teardown or
rebuild.

The hostname is `alb-{env}` and not `alb.{env}` because CloudFront validates the
origin's certificate against that name, and a `*.nahuat.com` wildcard matches
**exactly one label**. `alb.production.nahuat.com` is two labels and is not
covered. The name had to be changed after the fact for this reason.

### `origin_protocol_policy = "https-only"`

Not a hardening preference. The ALB's port-80 listener 301-redirects to HTTPS,
so an `http-only` origin produces an infinite redirect loop —
CloudFront → ALB → 301 → CloudFront — and the site cannot serve a page at all.
This was the state of production until it was found.

It also makes the path end-to-end encrypted, which is the reason usually given
for it and the less important one here.

### Failover is `custom_error_response`, not an origin group

The obvious mechanism is a CloudFront origin group failing over from the ALB to
an S3 maintenance bucket. It cannot be used: **CloudFront rejects
`POST`/`PUT`/`PATCH`/`DELETE` on any cache behavior that targets an origin
group.** Adopting it would break every mutation in the application to improve an
outage page.

Instead, 502/503/504 from the origin map to `/maintenance.html` served from S3,
returned with a 503 status and a 10-second error cache TTL. Every method stays
available.

This also fixes a gap the origin-group approach has: failover re-requests **the
same path** from the fallback, so a request for `/` asks S3 for the bucket root,
which returns 403 under Origin Access Control. The most common URL would never
show the page. `custom_error_response` names the path explicitly, so `/` works.

### No `default_root_object`

The planning draft set `default_root_object = "index.html"`, which is the
correct setting for static S3 hosting and wrong here: it rewrites `/` into
`/index.html` on *every* request, including normal ones, and an SSR origin has
no such route. It would break the homepage permanently in order to improve an
outage page.

### Cache policy follows content, not path

HTML is never cached — every response is SSR output that may be user-specific,
so it must reach the origin. Assets on `cdn.nahuat.com` get a one-year TTL and
no invalidation, because asset keys embed a timestamp and a nanoid: a changed
file is always a new URL, which makes invalidation unnecessary rather than
merely infrequent.

## Consequences

- Tearing down an application layer degrades to a styled maintenance page with
  no CloudFront involvement. This is exercised every time staging is destroyed.
- The maintenance page must be fully self-contained — inline CSS, no external
  references — because it renders precisely when the origin serving assets is
  unreachable.
- Errors are cached for 10 seconds, so recovery after the origin returns is not
  instant. Longer would prolong outages; shorter would hammer a failing origin.
- A genuine origin 502 during normal operation shows the maintenance page rather
  than an error. Acceptable: from a user's perspective those are the same event.
- Origin Access Control means the maintenance bucket is not publicly readable,
  and CloudFront reaches it via a bucket policy scoped to the distribution.

## Known gap

The maintenance page renders at `/` and at deep-linked paths, but a 403 from the
fallback origin is not mapped, so some failure shapes still surface raw. Tracked
in the backlog; the deliberate-teardown path, which is the one that matters, is
covered.

## Alternatives considered

**Origin group failover.** The documented mechanism for exactly this. Rejected
for the HTTP-method restriction, which is not negotiable for an app with form
posts.

**Route 53 health-check-based failover to a static site.** Works, adds DNS TTL
to recovery time, and duplicates the routing decision in a second system.

**A permanently-running minimal maintenance service.** Correct behaviour, and it
reintroduces the always-on cost the layer split exists to avoid.

**No maintenance page; let it fail.** Viable for staging, unacceptable for
production, and the mechanism is shared.
