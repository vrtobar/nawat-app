# 14. Nawat for the language, Nahuat for the project

- **Status:** Accepted
- **Date:** 2026-08-17
- **Applies to:** the whole repository
- **Amended 2026-08-18:** the repository and the project's written title move
  to Nawat. The rule below is unchanged — what changed is where the boundary
  falls, and one factual error about GitHub OIDC that made the repository look
  impossible to rename. See the two amended sections under Decision.

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

|              | Spelling   | Examples                                                                                                                                                                                   |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The language | **Nawat**  | `Entry.nawatContent`, `Translation.exampleNawat`, the `Common Nawat` dialect, every user-facing string, all prose describing the language, the project's title, the `nawat-app` repository |
| The project  | **Nahuat** | `nahuat.com`, `nahuat-production-*`, ECR `nahuat-api` / `nahuat-web`, `nahuat/production/*` secrets, the Terraform state bucket, `@nahuat/*` packages                                      |

Two consequences of the anchor worth stating explicitly, because both look like
oversights:

**The Auth0 custom claim namespace stays `https://nahuat.com/role`.** Auth0
requires a URI-shaped namespace, and this one is derived from the domain rather
than from the language. Changing it would mean updating the Post Login Action
and `JwtStrategy` in lockstep and invalidating every token minted before the
change, for no gain.

_Moot as of 2026-08-24, recorded 2026-08-25._ There is no custom claim namespace
any more — tokens carry no custom claims, and identity is read from the database
per request ([ADR 13](0013-authentication-and-authorization.md)). The naming
question this answered cannot recur unless claims do. The example is still a fair
illustration of the anchor: it was decided on the domain, and the domain is
`nahuat.com` regardless of what the language is called.

**The repository is `nawat-app`.**

_Amended 2026-08-18 — this section originally read "the repository slug stays
`nahuat-platform`", on two arguments. One was wrong and the other was
outweighed._

The wrong one: it claimed the OIDC trust policies condition on
`repo:vrtobar/nahuat-platform` and that renaming the repository would break
CI's ability to assume any AWS role. They do not. The condition is the
immutable-ID form —

    repo:vrtobar@4165944/nahuat-platform@1330083450

— documented at `infra/terraform/global/variables.tf`, whose own comment says
the IDs exist precisely so the claim survives renaming the user or the
repository. This record restated an understanding that the infrastructure had
already superseded. **Renaming is free. Migrating to a different repository is
not**, because the repository ID changes with it and `github_subject` must be
updated and the global stack re-applied.

The outweighed one: matching the domain. That still argues for `nahuat-`, and
it loses to something this record never weighed — a repository slug is read by
people, and the people who read this one are the linguistic and
language-learning communities where `nawat` is the correct spelling. Being
visibly right to them is not cosmetic for a preservation project asking
speakers to contribute.

So the boundary is sharper than "project versus language": **what people read
takes Nawat; what machines derive from the domain stays Nahuat.** The
repository, the title and the prose are read. The ECR repositories, task
definition families, secret paths, state bucket and `@nahuat/*` package names
are not, and they keep the domain's spelling for the reason given above.

### The title is "Nawat — an interactive dictionary and learning companion"

_Amended 2026-08-18 — this section originally gave the title as "Nawat
Platform"._

Written out, the project's name uses the language's name, so it takes the
language's spelling. "Platform" is dropped: it entered in the first README
commit before the scaffold existed, was never revisited, and is inaccurate —
a platform is something other people build on, which this is not and will not
be.

The bare word carries a claim the subtitle has to disclaim. Naming the project
exactly the language positions it as _the_ Nawat thing, which is the same
failure the `common` dialect description guards against: presenting one form
as the correct one is how the others quietly become wrong. "**A**n interactive
dictionary" rather than "the" leaves room for the print dictionaries, the
classes, and the people already teaching this language. "Companion" says the
same thing about the classes specifically — this accompanies that teaching
rather than replacing it.

"Interactive" modifies _dictionary_ and not the product, where it would say
nothing. Against the existing print and PDF dictionaries for Nawat, search,
audio and tap-to-define are the actual distinction.

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
