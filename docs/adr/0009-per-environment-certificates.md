# 9. One TLS certificate per environment

- **Status:** Accepted
- **Date:** 2026-08-14
- **Amends:** [ADR 4](0004-cloudfront-origin-and-failover.md), which recorded the
  hyphenated hostname workaround this replaces
- **Applies to:** `infra/terraform/environments/*/foundation/`

## Context

A single ACM certificate in the `global` layer — `nahuat.com` plus
`*.nahuat.com` — served every environment.

TLS wildcards match **exactly one label**. `*.nahuat.com` covers
`api.nahuat.com` but not `api.staging.nahuat.com`. That constraint reached into
hostname design, and three separate names were bent to fit it before the
pattern was named:

| Wanted                      | Became                      | Why                                                              |
| --------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `alb.production.nahuat.com` | `alb-production.nahuat.com` | CloudFront rejects an origin whose certificate does not cover it |
| `cdn.staging.nahuat.com`    | `cdn-staging.nahuat.com`    | `InvalidViewerCertificate` on the distribution                   |
| `api.staging.nahuat.com`    | `api-staging.nahuat.com`    | ALB accepts the certificate, then fails TLS at request time      |

The third is the dangerous one. An ALB accepts any certificate ARN without
checking the hostnames it will serve, so `terraform apply` succeeds and the
failure appears only on the first HTTPS request — including the web app's own
server-side fetches. Nothing in plan, apply, or validate catches it.

Environment-nested subdomains are a completely ordinary convention. The
constraint was never the naming; it was that one certificate had been made to
cover a whole domain.

## Decision

**Each environment's foundation layer owns a certificate covering exactly its
own hostnames.**

|            | Certificate                                   | Hostnames                                                                                          |
| ---------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Production | `nahuat.com` + `*.nahuat.com`                 | `nahuat.com`, `www.nahuat.com`, `api.nahuat.com`, `cdn.nahuat.com`, `alb-production.nahuat.com`    |
| Staging    | `staging.nahuat.com` + `*.staging.nahuat.com` | `staging.nahuat.com`, `api.staging.nahuat.com`, `cdn.staging.nahuat.com`, `alb.staging.nahuat.com` |

`staging.nahuat.com` is listed as an explicit SAN alongside the wildcard. It is
a single label, so `*.nahuat.com` already covers it — but naming it on the
staging certificate is what lets the staging web distribution use _that_
certificate, so no staging resource references production's.

Production keeps single-label hostnames. That asymmetry is the convention, not
an oversight: production owns the apex and omits the qualifier, which is why
`api.nahuat.com` and `api.staging.nahuat.com` is the shape almost everyone
uses. Nesting production under `production.` would put an internal environment
name into user-visible URLs.

## Consequences

- Staging depends on no production resource. A certificate replacement or a
  failed validation in one environment cannot affect the other, which matches
  what [ADR 3](0003-terraform-layer-split.md) already does for state.
- Hostnames are chosen for how they read, not for what a certificate happens to
  cover.
- Two certificates to renew instead of one. ACM renews DNS-validated
  certificates automatically as long as the validation records stay in place,
  and both sets live in the same hosted zone.
- A third environment needs its own certificate. This is the intended cost: it
  is a few lines in that environment's foundation, and it fails loudly at plan
  time rather than silently at request time.
- **`alb-production.nahuat.com` is still hyphenated.** It is covered by
  `*.nahuat.com` and works, but its shape is a leftover from the old
  constraint rather than a choice. Renaming it to `alb.nahuat.com` is tracked
  separately — it touches a live CloudFront origin and a Route 53 record for
  a purely cosmetic gain.
- ACM issues one validation CNAME covering both names on a certificate, so this
  added one DNS record, not two.

## Alternatives considered

**Add `*.staging.nahuat.com` to the existing global certificate.** One
certificate, one renewal. Rejected because ACM certificates are immutable, so
Terraform replaces rather than edits — repointing production's two CloudFront
distributions and its ALB listener, with a propagation window on a live site,
to fix a staging problem. The blast radius is backwards.

**Keep the hyphenated names.** Free, and works. Rejected because the naming was
being dictated by a certificate rather than by intent, and the failure mode for
getting it wrong is invisible until runtime.

**Nest production too, as `api.production.nahuat.com`.** Considered for
symmetry. Rejected: it exposes an internal environment name in URLs users see,
and `nahuat.com` and `www.nahuat.com` would remain unqualified anyway, so it
would introduce a mix rather than remove one.
