# 5. One Auth0 tenant per environment

- **Status:** Accepted
- **Date:** 2026-08-14 (records a decision taken 2026-08-13)
- **Supersedes:** two earlier positions recorded below

## Context

Auth0 provides authentication for both environments. Its free plan allows **one
tenant per account**, so "a tenant per environment" and "an account per
environment" are the same decision.

This record exists partly because the decision was made wrongly twice, and the
reasoning for the reversal is more useful than the conclusion.

**First position:** the free tier allows several tenants, so create one per
environment. Factually wrong — it allows one.

**Second position:** use two *applications* within a single tenant, because
maintaining two accounts is tedious. This is an argument about convenience
presented as an argument about architecture, and it does not survive contact
with what is actually tenant-scoped.

## Decision

**Separate Auth0 accounts, one tenant each: production, and staging + local
development.**

The existing tenant became production — it was already live and fully
configured, so leaving it untouched avoided re-verifying a working system. The
new account serves staging and local development.

### Why, on the merits

**A shared tenant turns the Post Login Action into a security boundary.**
Actions are tenant-level. One tenant serving both environments means a single
Action must branch on `event.client.client_id` to decide whether to call
`api.nahuat.com` or `api.staging.nahuat.com`, holding an internal secret for
each. A bug in that branch mints staging tokens carrying production roles. With
separate tenants each Action can reach exactly one API, so the failure mode is
structurally impossible rather than avoided by careful code.

**A shared tenant means Auth0 configuration can never be rehearsed.**
Connections, Actions, the email provider, and tenant settings are all
tenant-level. Every Auth0 change would be applied directly to production,
untested, always.

There is direct evidence of that risk in this project's own history: the
passwordless From-address configuration took four rounds to diagnose, because
setting the From address under Branding → Email Provider does **not** govern
passwordless OTP mail — that reads from Authentication → Passwordless → Email,
whose default `{{ application.name }} <root@auth0.com>` is rejected outright by
SES. Under a single tenant, all four of those attempts would have been against
live production.

**Separate applications isolate almost nothing.** They separate client IDs and
callback URLs. They share the user directory, connections, rate limits, Actions,
logs, and email configuration — which is where cross-environment incidents
actually come from.

### Timing

The decision had to be made before the first real signup, and was. Migrating
tenants later rewrites every `auth0Id`, which is a `@unique` column, and the
damage lands unevenly: Google identities would likely survive because the ID
derives from Google's subject, while passwordless identities would not because
`email|<random>` is generated per tenant. That leaves a partial migration with
two classes of user, which is worse than either extreme.

## Consequences

- Two logins, two credential sets, and a Machine-to-Machine application per
  tenant. Management API scopes are **per-tenant**: a new tenant's M2M
  application starts with none, and the symptom of forgetting is a 403 on a call
  that works against the other tenant.
- Google's OAuth client needs the new tenant's redirect URI added on the Google
  Cloud side; the Auth0 side alone is not sufficient.
- Configuration can drift between tenants, so staging stops being a faithful
  rehearsal. This is real, and it is the main cost — but it is a **visible**
  failure (staging behaves differently and you notice) rather than the
  **invisible** coupling of a shared tenant. Managing tenant configuration as
  code, via the Terraform Auth0 provider or `a0deploy`, would mitigate it and is
  worth having regardless.
- Production's tenant no longer lists `localhost` callback URLs, because local
  development points at the staging tenant.
- Each environment's Auth0 credentials live in that environment's Secrets
  Manager shell, which the layer split already separates ([ADR 3](0003-terraform-layer-split.md)).

## Open question

Whether Auth0's terms of service permit one person holding multiple free
accounts. Creating a second account specifically to exceed the one-tenant limit
is at least adjacent to circumvention. This was flagged before the decision was
taken and is not resolved.

**If the terms disallow it,** the fallback is separate applications in one
tenant, with the Post Login Action's routing logic treated as security-critical
and reviewed as such — not as plumbing.

## Alternatives considered

**Separate applications in one tenant.** The second position above. Rejected
because it isolates the two things that rarely cause incidents and shares
everything that does.

**One tenant, no separation at all.** Local development against production
identity. Rejected on the same grounds, more so.

**A paid Auth0 plan with multiple tenants under one account.** Resolves the
terms question and the operational overhead together. Not justified at current
scale, and worth revisiting if the terms question resolves against the current
approach.
