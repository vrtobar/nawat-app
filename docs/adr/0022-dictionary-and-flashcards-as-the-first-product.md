# 22. Dictionary and flashcards as the first product

- **Status:** Accepted
- **Date:** 2026-08-28
- **Applies to:** `packages/database/prisma/schema.prisma`, `apps/api/src/modules/`,
  and the scope of the first release
- **Depends on:** [ADR 20](0020-media-assets-provenance-and-the-approval-gate.md)
  for recordings and images, [ADR 19](0019-asynchronous-tier-anchored-on-media-processing.md)
  for the consumer this re-scopes

## Context

The schema describes twenty-one models. Five have code behind them: `User`,
`RefreshToken`, `Entry`, `Dialect` and `Translation`. The remaining sixteen are
referenced nowhere in the application — the whole of
`Level → Course → Unit → Lesson → Exercise`, the vocabulary and exercise join
tables, four progress models, activity, and the flashcard subsystem.

They were designed before the dictionary existed and have not been revisited
since. The design is coherent; what is missing is evidence, because none of it
has met a real requirement.

**The scope has no finish line.** Everything built so far — authentication, the
dictionary, the editor — is infrastructure beneath a product that has not been
defined tightly enough to be finished. "Duolingo-style learning app" describes
an ambition rather than a release.

**Two things separate cleanly, and the schema already knows it.** The flashcard
subsystem has no foreign key into the learning hierarchy. `Flashcard` references
a set and a `Translation`; `UserCardProgress` is keyed on
`(userId, translationId)` and carries the full scheduling state. **Spaced
repetition is anchored to the dictionary, not to lessons.** Nothing has to be
severed to build one without the other.

**The two halves are not comparable amounts of work, and the difference is not
engineering.** A dictionary is bounded: there are a finite number of words, and
each is an entry, some translations, and a recording. A course is unbounded
design work — deciding what is taught in what order, writing exercises, and
sequencing difficulty. That is pedagogy, it requires teaching expertise rather
than software, and it is an order of magnitude more authoring.

For a language with roughly a hundred speakers, that difference has a
consequence beyond scheduling. A dictionary with recordings preserves something
on its own if the project goes no further. A half-authored course does not.

## Decision

- **The first product is the dictionary and flashcards, with audio and images.**
  Entries, dialects, search, media, decks built from dictionary translations,
  the spaced-repetition review loop, and the progress that follows from it. It
  is a complete and useful tool at that boundary, and the boundary is where the
  first release ends.
- **Images ship with audio, not after it.** They share one pipeline and one
  approval path (ADR 20), so separating them would cost more than building them
  together, and a dictionary that is only text and sound is a poorer artefact
  than the schema already anticipates.
- **The learning hierarchy is deferred, and its models are removed from the
  schema.** `Level`, `Course`, `Unit`, `Lesson`, `LessonVocabulary`, `Exercise`,
  `ExerciseTranslation`, `UserCourseProgress`, `UserUnitProgress`,
  `UserLessonProgress` and `UserLessonAttempt` are dropped. They are empty, so
  the migration is free in both directions.
- **`lesson-completion-consumer` is re-scoped to review-session completion.**
  Its work — activity logging, streaks, and experience — is unchanged; only its
  trigger moves, from finishing a lesson to finishing a review session. See
  [ADR 19](0019-asynchronous-tier-anchored-on-media-processing.md), which had
  already moved card seeding into the request path.
- **Deferred is not cancelled.** The hierarchy is expected, and the dictionary
  and its recordings are what it would have been built on regardless.

## Why the models are dropped rather than kept

Empty tables cost nothing to carry, and this is the same question that deleted
three queue consumers in [ADR 19](0019-asynchronous-tier-anchored-on-media-processing.md).
The answer is the same for the same reason: a schema is read as a set of
decisions, and these ones have already leaked. `modules/monitoring` specifies
`LessonsCompleted` and `SRSReviews` as business metrics; ADR 19 had to reason
around a consumer for lessons that do not exist. Each of those inherited a shape
nobody had re-examined.

The usual objection to dropping — that migrations are expensive — does not apply
to empty tables. The expensive migration is one carrying data, and there is
none. What is expensive is designing a curriculum twice: once now, without
knowing what a Nawat course should teach, and again when that is known.

## Consequences

- **The release has a finish line.** Scope becomes a set of features that can be
  completed rather than a direction of travel, which is what makes it possible
  to say the first version is done.
- **The product is positioned differently than the original framing.** A
  dictionary with spaced repetition and audio is not a course-based learning
  application; it is a reference tool that teaches. That is a smaller claim and
  a truer one for what will exist.
- **Media becomes the critical path.** A flashcard for a spoken language without
  a recording is missing the point, so ADR 20's pipeline moves from a planned
  capability to a prerequisite of the first release.
- **`FlashcardSet.isOfficial` and `isFeatured` carry more weight.** Without a
  curriculum ordering the material, curated decks are the only editorial
  structure available, and they become how a learner is guided rather than a
  convenience.
- **Progress reporting narrows.** Streaks and activity have review sessions to
  hang from, but course and unit completion do not exist to be reported.
- **Re-adding the hierarchy is a schema change, not a schema restoration.** It
  will be designed against a working product and real content, which is the
  point, but it should not be assumed to return in the shape being removed here.

## Alternatives considered

- **Build the learning hierarchy first, as originally planned.** Rejected: it is
  the half that cannot be finished without curriculum authoring that has not
  started, and it depends on dictionary content that does not exist yet either.
- **Keep the models and build around them.** Rejected for the reason above —
  they are already being treated as decided by records that had to reason around
  them, and carrying them costs more in misdirection than the migration costs to
  reverse.
- **Ship the dictionary alone and defer flashcards too.** Rejected: spaced
  repetition needs no infrastructure beyond what the dictionary already
  provides, since the schema anchors it to translations, and a dictionary that
  cannot teach is a smaller product for very little less work.
- **Defer images and ship audio only.** Rejected: they share a pipeline, an
  approval path and a storage model, so splitting them means building the same
  machinery twice.
