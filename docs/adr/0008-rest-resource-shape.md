# 8. Shallow-nested REST resources

- **Status:** Accepted
- **Date:** 2026-08-14 (records a decision taken 2026-08-12)
- **Applies to:** `packages/shared/src/schemas/`, `apps/api/src/modules/`

## Context

The content model is a five-level hierarchy — Level → Course → Unit → Lesson →
Exercise — with a parallel dictionary hierarchy of Entry → Translation. Every
child has exactly one parent.

A hierarchy that deep invites fully-nested routes:

```
GET /levels/:levelId/courses/:courseId/units/:unitId/lessons/:lessonId
```

This is a defensible convention and the one most familiar from prior work. It
is also the reason the decision needed making explicitly: at five levels the
costs compound in a way they do not at two.

Note that this record predates the controllers. It is the contract they will be
written against, not a description of existing code.

## Decision

**Shallow nesting.** A resource is nested exactly one level deep when the parent
is required to identify it, and top-level otherwise.

```
POST   /api/v1/levels/:levelId/courses      create — parent from the path
GET    /api/v1/levels/:levelId/courses      list within a parent
GET    /api/v1/courses/:id                  fetch by ID
PATCH  /api/v1/courses/:id                  update by ID
DELETE /api/v1/courses/:id                  delete by ID
```

Two rules follow from it:

**Create and list take the parent from the path, never from the body.** A
`POST /courses` carrying `levelId` in its payload has two sources of truth for
where the resource belongs, and nothing prevents them disagreeing. Putting the
parent in the path makes the relationship unambiguous and makes authorization
checkable before the body is parsed.

**IDs are globally unique, so deeper nesting adds nothing.** Once a course ID
identifies a course, the level ID in front of it is decoration that must still
be validated for consistency — an extra failure mode with no extra information.

### Resources are top-level, not grouped under a module prefix

Routes are `/api/v1/levels`, `/courses`, `/units`, `/lessons`, `/exercises`,
not `/api/v1/lessons/courses` and so on. The earlier draft grouped four
resources under a `/lessons/` prefix because they belong to one NestJS module.

That leaks an implementation detail into the public contract, and it created
literal-vs-parameter route collisions: `/lessons/exercises` and
`/lessons/:lessonId` are ambiguous, and resolving them depends on registration
order. Removing the prefix removes the class of bug rather than working around
it.

## Consequences

- URLs stay short and stable regardless of hierarchy depth. Adding a level to
  the content model does not lengthen any existing URL.
- A client holding a course ID can fetch it without knowing its ancestry.
- The parent ID is absent from update payloads, so **moving** a resource to a
  different parent has no route. This is deliberate: it is a distinct operation
  with distinct authorization, and it gets an explicit endpoint if it is ever
  needed.
- Authorization for create is a single check on the path parameter, uniform
  across every create route.
- `api-reference.md` predates this decision and still shows flat creates with
  parent IDs in the body, plus the `/lessons/` prefix. It contradicts
  `packages/shared` and must be corrected before the controllers are written.

## Alternatives considered

**Full nesting.** Expresses the hierarchy in the URL and makes ancestry
self-documenting. Rejected: at five levels the deepest URL carries four IDs that
must each be validated for mutual consistency, every client must track the full
path to make any request, and the collision problem above gets worse rather than
better.

**Fully flat, parent in the body.** `POST /courses` with `{ levelId }`.
Rejected because it splits the identity of a resource across path and body for
creates and makes list-by-parent a query parameter rather than a route, which
weakens caching and authorization.

**GraphQL.** Removes the question entirely. Not justified for a single
first-party client, and it would trade a well-understood caching story at the
CDN for one that has to be built.
