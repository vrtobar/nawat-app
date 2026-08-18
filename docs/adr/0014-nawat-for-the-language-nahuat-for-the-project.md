# 14. Nawat for the language, Nahuat for the project

- **Status:** Accepted
- **Date:** 2026-08-17
- **Applies to:** the whole repository

## Context

This project carries two spellings of the same word, and a reader who does not
know why will reasonably file it as a typo.

**Nawat** is the orthography the language revitalization movement in El
Salvador standardised on. It is what the teaching materials use, what the
linguistic data uses, and what the community that still speaks the language
uses when writing it.

**Nahuat** is the older spelling. It is still widely recognised — which is why
`nahuat.com` was registered, before the orthography question had surfaced. The
domain is the one decision here that predates the knowledge, and it is not
being reversed: it is bought, it is live in production, and its recognisability
is worth something to a preservation project that wants to be findable by
people searching for the older form.

So the question is not which spelling is correct. It is what to do when the
project's own name, fixed by a domain, disagrees with the language's.

Doing nothing means an application that teaches Nawat refers to it throughout
as Nahuat — a spelling its speakers have moved away from — which is the wrong
outcome for a project whose stated purpose is preservation.

## Decision

**If it names the language, it is Nawat. If it names the project, it is
Nahuat.**

The domain anchors the second half. Everything derived from `nahuat.com` keeps
that spelling, because the alternative is infrastructure named differently from
the domain it serves — a new inconsistency traded for the old one.

|              | Spelling   | Examples                                                                                                                                                                                |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The language | **Nawat**  | `Entry.nawatContent`, `Translation.exampleNawat`, the `Common Nawat` dialect, every user-facing string, all prose describing the language                                               |
| The project  | **Nahuat** | `nahuat.com`, `nahuat-production-*`, ECR `nahuat-api` / `nahuat-web`, `nahuat/production/*` secrets, the Terraform state bucket, `@nahuat/*` packages, the `nahuat-platform` repository |

Two consequences of the anchor worth stating explicitly, because both look like
oversights:

**The Auth0 custom claim namespace stays `https://nahuat.com/role`.** Auth0
requires a URI-shaped namespace, and this one is derived from the domain rather
than from the language. Changing it would mean updating the Post Login Action
and `JwtStrategy` in lockstep and invalidating every token minted before the
change, for no gain.

**The repository slug stays `nahuat-platform`.** Beyond matching the domain,
the GitHub OIDC trust policies condition on
`repo:vrtobar/nahuat-platform`. Renaming the repository breaks CI's ability to
assume any AWS role until those IAM conditions are updated — the role ARNs
survive a rename, the trust conditions do not.

### The human-readable title is "Nawat Platform"

Written out, the project's name uses the language's name, so it takes the
language's spelling. The machine identifier derived from the domain —
`nahuat-platform` — does not. That asymmetry is the rule working, not an
exception to it.

## Consequences

- **Two spellings coexist deliberately, and this record is the only thing that
  distinguishes that from drift.** Anyone filing "typo: nahuat.com should be
  nawat.com" should land here.
- Field, column and index names carrying the language are renamed —
  `nahuat_content` becomes `nawat_content`, `entries_nahuat_content_trgm_idx`
  becomes `entries_nawat_content_trgm_idx`. Done while the content tables are
  empty, so it costs a migration and no data handling.
- The rule is mechanical enough to apply without asking: the test is whether
  the token names the language or the thing that teaches it.
- Search and replace across the repository is **not** a safe way to act on
  this. The two categories are interleaved in the same files — a Terraform
  module can name both a resource and the language in adjacent lines.
- Someone reading only the infrastructure will conclude the language is spelled
  "Nahuat". That is the residual cost of anchoring on a domain, and it is
  accepted: infrastructure is read by operators, and the learner-facing surface
  is where the spelling matters.

## Alternatives considered

**Rename everything, including the domain.** The only option that leaves one
spelling. Rejected: the domain is registered and live, moving it means a
migration of DNS, certificates, CloudFront aliases, the Auth0 callback and
claim namespace, and every user-visible URL — and it discards recognisability
that has real value for a project trying to be found by people who know the
older spelling.

**Rename the infrastructure but keep the domain.** `nawat-production-*` serving
`nahuat.com`. Rejected: it swaps one inconsistency for a worse one, since the
resource prefix would then match nothing at all. Many of those renames also
force resource replacement rather than an in-place update.

**Keep "Nahuat" everywhere, including the language.** Internally consistent and
free. Rejected on the merits of what this project is for: an application that
teaches Nawat should spell it the way the people reviving it spell it, and the
data it stores is drawn from sources that already use the `w`.

**Treat it as a display concern — store `nahuat`, render "Nawat".** Rejected as
the worst of both: it puts a translation layer between the database and every
reader, and the stored spelling would still be wrong in exports, logs, and any
direct query.
