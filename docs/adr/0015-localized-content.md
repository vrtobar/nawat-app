# 15. Localized content: storage, naming, and locale resolution

- **Status:** Accepted
- **Date:** 2026-08-17
- **Applies to:** `packages/database/prisma/schema.prisma`,
  `packages/shared/src/schemas/`, and every content-serving endpoint
- **Depends on:** [ADR 14](0014-nawat-for-the-language-nahuat-for-the-project.md)
  for the spelling of the Nawat-bearing fields

## Context

The schema treats English as an optional gloss on dictionary entries.
`Translation.spanishContent` is required and `englishContent` is nullable; six
models — `Dialect`, `Level`, `Course`, `Unit`, `Lesson`, `FlashcardSet` — carry
a single `title`/`name` and `description`; and exercise prompts derive from
`spanishContent`. Everything follows consistently from one premise: that
learners read Spanish.

**That premise is wrong.** There are Salvadorans, largely diaspora, who speak
mainly or only English and want to learn Nawat, and separate English-language
Nawat classes already exist for them. English is a language people learn Nawat
_in_, not a convenience for people reading the dictionary.

This record predates the code it governs; no controller reads or writes
localized content yet. It is being written now because the content tables are
empty, and every decision below is a schema edit today and a re-authoring
project once there are hundreds of lessons.

## Decision

### 1. Parallel columns, named `<field><Locale>`

```
titleEs / titleEn        descriptionEs / descriptionEn
contentEs / contentEn    exampleEs / exampleEn
```

The codebase already solves this problem once, in
`Translation.spanishContent` / `englishContent`. A second mechanism for the
same concept is the drift [ADR 10](0010-zod-as-the-payload-contract.md) exists
to prevent, so the existing shape wins — but the naming changes, because the
suffix form does work the prefix form cannot:

```ts
type Locale = 'Es' | 'En';
row[`content${locale}`]; // typed via template literal types
```

Locale resolution becomes mechanical across every field. With
`spanishContent`/`englishContent`, each field needs its own mapping.

JSONB (`{ es, en }`) was the main alternative and is rejected below; it earns
its keep when the language set is open-ended, which two known languages are
not.

**The Nawat-bearing fields keep their own naming**, per ADR 14 and for a
second reason: `nawatContent` and `exampleNawat` are never selected by locale.
They are shown to every learner regardless of language. Naming them
`contentNawat` would advertise membership in the locale-resolution set, and
`Nawat` is never a value of `Locale`. The asymmetry marks a real behavioural
difference — one field is the subject, the others describe it.

### 2. English is required to publish, not to create

The people who know Nawat live in El Salvador and speak Spanish. **Requiring
English at creation puts a barrier on the primary contribution path**: a Nawat
speaker could not record a word without producing an English gloss they may not
be able to write.

So Spanish is required at creation, and both languages are required at
publish. That gate already exists — `Course`, `Unit` and `Lesson` each carry a
`_NOT_PUBLISHABLE` error code and a guard. This is one more condition on it.

**Dictionary entries are exempt from the publish requirement.** A lesson half
in Spanish is broken; a dictionary with 300 Spanish glosses and 200 English
ones is a dictionary mid-build. Entries publish with Spanish alone and are
filtered per locale instead.

### 3. No fallback

An English learner is never shown Spanish content. They may not read it — and a
silent fallback makes a missing translation invisible, so nobody notices it and
nobody fills it. Filtering makes the gap countable, which turns it into a work
queue: "142 entries lack English" is actionable in a way that silently degraded
pages are not.

The Nawat content itself never falls back or filters. It is the subject.

### 4. Locale is resolved server-side

Resolution order: explicit `?locale=` → `User.locale` → `Accept-Language` →
`es`.

A user's stored choice beats their browser's, because a Salvadoran-American may
well have an English browser and want Spanish. Public dictionary browsing has
no user, which is why the header and the default remain in the chain.

**The API returns resolved content rather than every language**, and the
deciding argument is pagination. Entries lacking English must be filtered out
for an English learner; if that filtering happens client-side, page one shows
twelve of twenty results and the total count is wrong. Filtering has to be
server-side, so resolution may as well be.

**`User.locale` is delivered on the access token, not read per request**
(added 2026-08-19).

> **SUPERSEDED 2026-08-24, recorded 2026-08-25.** There is no locale claim, and
> no custom claims at all — the Post Login Action that minted them is deleted
> ([ADR 13](0013-authentication-and-authorization.md)). `User.locale` is now read
> per request from the user row, as one of the four fields
> `AuthService.resolveIdentity()` returns, and `JwtClaimsSchema` makes `locale`
> **required** where it was optional as a claim: a row always has one, so there
> is no authenticated request where it can be absent.
>
> Three things below stop applying with it. The staleness this section accepts is
> gone — a locale change takes effect on the next request, so the `?locale=`
> override no longer has to paper over anything. The "fails soft" behaviour has
> no subject, since there is no claim to be malformed. And the closing argument —
> that a per-request read buys nothing because the public dictionary has no user
> — was answered by the request being made anyway for `role` and `userId`; the
> locale rides along on a read that already happens, and anonymous requests still
> resolve through `Accept-Language` without one.
>
> Retained because the resolution chain itself (§4) is unchanged, and because the
> reasoning is the clearest record of what the claims design was buying.

The resolution chain names `User.locale`, but the token
deliberately carries no database state — `role` and `userId` come from claims so
authorization costs no query. Rather than reintroduce a per-request read for the
locale step, the Post Login Action embeds `User.locale` as a
`https://nahuat.com/locale` claim alongside the other two, and `@ContentLocale()`
reads it from `request.user`.

The cost of a claim is staleness: it is a login-time snapshot, so a locale change
does not reach the token until it next refreshes. That is acceptable here only
because the explicit `?locale=` override sits _above_ the claim in the chain — a
user who changes the setting has the frontend send the new value immediately, and
the token default catches up on its own. So no session revocation and no forced
re-login, unlike a `role` change. The claim is optional and fails soft: a token
predating it, or carrying a malformed value, resolves to no stored preference and
falls through to `Accept-Language`, never rejecting the token. Putting locale in
the token was chosen over a per-request `User.locale` read because the first
consumer — the public dictionary — has no user at all, so a read would buy
nothing on the path that matters.

### 5. Field renames carried in the same migration

| From             | To                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `spanishContent` | `contentEs`                                                                                 |
| `englishContent` | `contentEn`                                                                                 |
| `exampleSpanish` | `exampleEs`                                                                                 |
| —                | `exampleEn` _(new — an English learner otherwise gets a Nawat example with no translation)_ |
| `nahuatContent`  | `nawatContent` _(ADR 14)_                                                                   |
| `exampleNahuat`  | `exampleNawat` _(ADR 14)_                                                                   |

**`phonetic` stays a single field, defined as IPA.** Whether it should be split
was genuinely unclear: a pronunciation respelling is written for a specific
reader, since Nawat's `x` is /ʃ/ and a Spanish speaker has to be told it sounds
like English "sh" while an English speaker needs the opposite hint or none. The
expensive failure is not the wrong column count — it is free-text respellings
in mixed conventions that cannot later be attributed to a reader. Defining the
field as IPA removes the ambiguity; if the teaching materials turn out to use a
respelling convention, `phoneticEs` and `phoneticEn` are added alongside it and
`phonetic` keeps its meaning. Splitting a free-text field afterwards is the
migration that cannot be done cleanly.

**The two speculative btrees on the renamed columns are dropped rather than
renamed.** They served equality, prefix and `ORDER BY`, which GIN does not, but
no query needs them; the trigram indexes cover substring search. Dropping is
cheaper than renaming something already suspected of being dead weight, and
re-adding is one line when a query wants it.

## Consequences

- **Six models gain four columns each** where they had two. The schema is
  wider, and every content query selects a locale-specific subset.
- **`User` needs a `locale` column**, which does not exist. It is the input to
  everything in §4.
- **Publishing gets harder**, deliberately. A course cannot go live until
  someone has written it twice, which is a real cost paid by whoever runs the
  project rather than by contributors recording vocabulary.
- **A third language is an additive migration on six tables** — mechanical, and
  the point at which JSONB should be reconsidered rather than assumed wrong.
- **Prisma does not infer renames.** `migrate dev` generates `DROP COLUMN` plus
  `ADD COLUMN` for each of the five, which discards data. Harmless today at
  zero rows, but the migration is hand-edited to `ALTER TABLE … RENAME COLUMN`
  because that is the correct SQL and it establishes the pattern for a rename
  that happens against real content. Hand-editing migrations is already normal
  here — see [ADR 12](0012-migration-composition-and-index-ownership.md).
- **Four indexes reference the renamed columns** and are renamed or dropped
  with them, along with their `map:` values in `schema.prisma`. Left alone,
  Prisma reports drift on the next diff.
- **Exercise generation is not resolved here.** Prompts derive from what is now
  `contentEs`, and a multiple-choice question with Spanish distractors is a
  _different exercise_ from its English counterpart rather than a translation of
  one. Whether exercises become locale-specific rows or stay parameterized at
  generation time depends on all four decisions above and is deferred.
- **Frontend routing is not resolved here** either. `/es/…` versus `/en/…`
  versus a cookie is a Next.js decision that follows this record rather than
  leading it.

## Alternatives considered

**JSONB `{ es, en }` per field.** Adding a language becomes data rather than a
migration. Rejected because the set is two, both known and both first-class:
the flexibility buys nothing here and costs `Dialect.name @unique`, clean
`ORDER BY title`, and any index on a title. Prisma's JSON typing is also
substantially weaker than a column's.

**A per-entity translation table.** The textbook answer, and the one that
scales furthest. Rejected as disproportionate: it adds a join to every content
read — including the level → course → unit → lesson walk, which would take one
per tier — to solve a problem two columns solve, and a polymorphic variant
would trade foreign-key integrity for the convenience.

**Keep `spanishContent`/`englishContent` and add `titleEs`/`titleEn`.** No
rename, no migration risk. Rejected because it leaves two naming conventions
for one concept in the same schema, and forfeits the parameterized access in
§1 that makes resolution uniform.

**Require English at creation.** Simplest rule, no partial content ever.
Rejected: it blocks the contribution path the project depends on, from the
people most able to supply the data.

**Fall back to Spanish when English is missing.** Every page always renders.
Rejected because it renders content the reader may be unable to read, and hides
the gap from the only people who could close it.
