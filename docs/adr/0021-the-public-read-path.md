# 21. The public read path: topology, caching, and anonymous access

- **Status:** Accepted
- **Date:** 2026-08-28
- **Applies to:** `apps/web/`, `apps/api/`, `modules/compute`, and the CloudFront
  distribution in each foundation layer
- **Depends on:** [ADR 4](0004-cloudfront-origin-and-failover.md) for the
  distribution, [ADR 18](0018-own-authentication-google-only.md) for token issuance
- **Closes:** the cache's purpose, left open by
  [ADR 19](0019-asynchronous-tier-anchored-on-media-processing.md)

Parts of this record describe work that does not exist yet.

## Context

The dictionary is public, read-heavy, and mostly anonymous. The request path it
is served by was assembled a piece at a time and has never been examined as a
whole.

**Every page render leaves the VPC and comes back.** `API_URL` is
`https://api.nahuat.com`, and the dictionary pages fetch in server components on
the ECS origin. That hostname resolves to the internet-facing load balancer, so
a call between two services in the same VPC is routed out through the NAT
gateway and back in. NAT is the largest single line in the hourly cost of an
environment and bills per gigabyte processed on top.

**Nothing dynamic is cached anywhere.** The distribution's default behaviour is
`CachingDisabled` for everything except `/_next/static` and the maintenance
page. The dictionary pages carry no `revalidate`, no `generateStaticParams` and
no cache configuration, so every view of every word renders on ECS and queries
Postgres. ElastiCache runs in both environments with no client library installed
anywhere in the repository.

**The API is publicly exposed without a decision behind it.**
`NEXT_PUBLIC_API_URL` is injected and never read — it appears once, in a comment
explaining that it is not used. No browser code calls the API. So
`api.nahuat.com` currently serves no client, while sitting outside CloudFront
with no WAF and no rate limiting in front of it.

That last fact suggested making the API internal. **A mobile client is planned,
which forecloses it**: a native application has no server-side renderer to reach
through, so the API is a public product surface rather than an implementation
detail.

## Decision

- **The API stays public and moves behind CloudFront.** A native client needs
  it, and the distribution is what gives WAF, edge termination and rate-based
  rules a single place to attach. Postman and any future third-party consumer
  use the same public endpoint.
- **The web tier reaches the API by an internal path.** Server-side rendering
  resolves an in-VPC address rather than the public hostname, so a page render
  no longer traverses NAT. The public and internal routes coexist; they are not
  alternatives.
  - ⚠️ The internal name must be resolvable from an ordinary EC2 instance, so
    that the bastion can forward it for manual testing. ECS Service Connect is
    rejected for this reason: its names resolve only for tasks inside the mesh.
- **Public dictionary pages are generated, not rendered per request.** Entries
  change when an administrator publishes them, which is an event the application
  already handles, so pages are statically generated and revalidated on publish
  and unpublish.
- **Authenticated chrome is rendered on the client.** Server-rendered
  user-specific navigation makes one URL produce different HTML per viewer,
  which no cache configuration can resolve — it forces either a per-session
  cache key, which collapses the hit rate to nothing, or nothing cached at all.
  User-independent HTML is the precondition for everything above.
- **Search remains dynamic, and is where the cache is used.** Arbitrary query
  strings cannot be generated ahead of time. This, with rate limiting below, is
  what ElastiCache is for; the question ADR 19 left open is closed here.
- **Anonymous clients may read the whole public dictionary.** Entry pages,
  search and browse require no account. See below for why this is not a
  concession.
- **Everything that is not the public dictionary requires authentication** — the
  administrative surface, the editor, anything touching a user's own data, and
  any bulk export added later.
- **Rate limits exist to protect availability, not to restrict copying.** They
  are sized so that one client cannot degrade the service for others. Per-token
  limits are held in the cache, since they cannot live in a single task's memory
  once more than one task runs.

## Why anonymous reads stay open

The instinct to gate reads is that bulk extraction is characterised by
enumeration — walking the whole list — rather than by request volume, and that
list access is therefore the thing to restrict.

**Discoverability defeats that.** Being findable through a search engine is a
primary purpose of publishing a dictionary for a language with roughly a hundred
speakers, and it requires the URL space to be public and indexed. A sitemap
enumerating every entry is how indexing happens, and it supplies the same
enumeration that restricting the API would withhold. Publishing one while
capping pagination on the other protects nothing.

So the choice is between discoverability and enumeration control, and this
project needs the first. Recognising that changes what the remaining controls
are for: **caching, not access control, is what makes bulk reading harmless** —
generated pages served from the edge mean a full traversal costs the origin
close to nothing. Access controls over content that is published to be read
cannot restrict its redistribution, and sizing rate limits as though they could
leads to tightening them against a goal they cannot reach, at the expense of the
readers they do affect.

## Consequences

- **Serving a page stops requiring the database.** The origin is consulted on
  publication rather than on reading, which is the difference between capacity
  scaling with readers and capacity scaling with editors.
- **Stale content becomes possible, and is a new failure mode.** A publish whose
  revalidation does not fire leaves the previous page served with nothing
  reporting it. A bounded time-to-live is the backstop; the revalidation path
  needs to be treated as a thing that can fail.
- **First paint shows signed-out navigation briefly.** The cost of
  user-independent HTML, paid on every page including for signed-in users.
- **The API gains a second consumer before it has an interface contract.** A
  native client shipped to an application store cannot be corrected on the same
  schedule as a web page, which raises the value of a published API description
  from convenience to necessity.
- **ElastiCache stops being unused.** Rate limiting is its first consumer, and
  is buildable before search caching is measurably needed.
- **Two routes to one service must both keep working.** The internal path is the
  one exercised on every page view and the public path is the one exercised by
  clients, so a fault in either is invisible from the other.

## Alternatives considered

- **Make the API internal-only.** Rejected once a mobile client was planned; a
  native application cannot reach an unexposed service. It would otherwise have
  been the strongest option, since it removes the surface rather than defending
  it.
- **Leave server-side rendering calling the public hostname.** Rejected: it pays
  NAT processing and public round-trip latency on every render for a call
  between two services in one VPC, and it puts internal traffic through the
  internet-facing load balancer.
- **Cache the rendered HTML without changing where authenticated chrome is
  rendered.** Rejected: it requires the session cookie in the cache key, which
  makes the hit rate approximately zero, or omitting it, which serves one
  viewer's page to another.
- **ECS Service Connect for the internal path.** Rejected on operability: its
  names resolve only within the mesh, so an ordinary instance cannot reach the
  service, and manual testing through the bastion would stop working.
- **Require an account to read the dictionary.** Rejected: it removes search
  engine indexing, which is a primary route to the readers this exists for, and
  it does not prevent enumeration by anyone willing to register.
