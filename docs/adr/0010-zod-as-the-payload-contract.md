# 10. Zod schemas as the only payload contract

- **Status:** Accepted
- **Date:** 2026-08-16 (records a decision taken 2026-08-15)
- **Applies to:** `packages/shared/src/schemas/`,
  `apps/api/src/common/pipes/zod-validation.pipe.ts`

## Context

Every request payload has to be validated at the boundary. NestJS's documented
answer is a `class-validator` DTO: a class per payload, constraints expressed as
property decorators, bound by a global `ValidationPipe`.

`packages/shared` already defines every payload as a Zod schema, with the
TypeScript type derived from it rather than written alongside it:

```ts
export const CreateLevelSchema = z.object({
  title: z.string().min(1).max(200),
  order: z.number().int().min(1),
});

export type CreateLevel = z.infer<typeof CreateLevelSchema>;
```

Adopting DTOs would mean every payload is defined twice — once as a Zod schema
and once as a decorated class — in two different vocabularies of constraint,
with nothing checking that they agree.

This project has already paid for that shape once. `.claude/api-reference.md`
was a second, hand-maintained description of the same contract, and it had
drifted from `packages/shared` in four separate ways by the time the two were
reconciled on 2026-08-15.

Note that this record mostly predates the code it governs. Two controllers
exist — `POST /auth/role` and `GET /users/me`. It is the contract the rest will
be written against.

## Decision

**One Zod schema per payload in `packages/shared`, validated by
`ZodValidationPipe`. No `class-validator` DTOs anywhere.**

```ts
@Post()
create(@Body(new ZodValidationPipe(CreateEntrySchema)) body: CreateEntry) {}
```

Three properties of that arrangement are load-bearing.

**The pipe is applied per parameter, not globally.** A global pipe receives the
value and the parameter's metadata, but nothing tells it which of forty schemas
this handler expects. Binding the schema at the parameter is what makes the
question answerable, and it lets one handler validate a body with one schema
and a query string with another.

**The pipe returns the parsed value, not the input.** This is not a detail.
Query parameters arrive as strings while handlers are typed as receiving
numbers, so returning the original value would typecheck and then fail at
runtime; schema defaults — `PaginationParamsSchema`'s `page` and `limit` —
would also never reach the handler.

**Validation failures are thrown as an exception payload, not as a finished
response body.** The error envelope requires a `correlationId`, and only the
exception filter can supply one: a pipe has no request context, and a pipe that
invented an id would emit something that correlates with nothing in the logs.
The pipe produces `ApiErrorDetail[]` with the parameter type prefixed onto each
path — `body.nahuatContent`, `query.page` — so a client can tell a bad query
parameter from a bad body field.

### Why this contradicts NestJS convention, deliberately

The convention is real and worth stating plainly: Nest's documentation, its
generators, and `@nestjs/swagger` all assume decorated DTO classes. A reviewer
opening this repository expects `CreateEntryDto` with `@IsString()` on it, and
its absence looks like an omission rather than a decision.

What the convention buys is that one set of decorators serves both validation
and generated documentation. What it costs is that a `class-validator` DTO is
useless outside the API process. Its constraints exist only as runtime metadata
on a class in a Nest DI container; a browser cannot import it as the source of
a type, so the frontend restates the shape and the two drift. A Zod schema is
simultaneously the runtime validator and the static type, and it is portable
because it is an ordinary value — `packages/shared` depends on nothing but
`zod`.

This is not a general preference for the unconventional. The same week, JWT
verification went to Passport rather than to `jose` **because** it is the
convention a NestJS reviewer expects, and a single strategy does not otherwise
need Passport's orchestration. The convention is departed from where it forces a
second definition of a payload, and followed where it costs nothing.

### It governs work that does not exist yet

Two pieces of unbuilt work are decided by this record rather than by their own.

**The OpenAPI document is generated from the schemas, not hand-written.** Zod
4.4.3 ships `z.toJSONSchema()` natively — verified 2026-08-15 against a
Level-shaped schema, which emitted draft 2020-12 with `minLength`, `integer` and
`required` preserved — so neither `nestjs-zod` nor
`@asteasolutions/zod-to-openapi` is needed. `@nestjs/swagger` is not an option
here at all: it harvests its document from decorator metadata on DTO classes,
which this project does not have and has just decided not to acquire. The open
question is therefore shape rather than tooling — schema definitions come from
`packages/shared`, but route metadata (path, method, required role) has to come
from either a small registry or light decorators. That question is open, and is
best answered once two or three controllers exist and the pattern is visible.

**SQS message shapes get the same treatment across the language boundary.**
Three of the four queue consumers are moving to Python
([ADR 11](0011-polyglot-workers-and-packaging.md)), which makes producer and
consumer different languages and puts a message shape in exactly the position
this record exists to avoid: defined twice, checked by nothing. The intended
answer is the same tool — `z.toJSONSchema()` emitting a schema the Python side
validates against — so the Zod definition stays the single source and the
Python definition is generated rather than transcribed. Not built; recorded so
the message shapes are not hand-written into both sides first.

## Consequences

- Every payload has exactly one definition, and its TypeScript type is derived
  from that definition rather than maintained beside it.
- **Nothing enforces that the pipe is applied.** A handler written as
  `@Body() body: CreateEntry` typechecks perfectly and validates nothing at
  runtime, because the type annotation is a claim rather than a check. This is
  the price of dropping the global pipe, and it is a real one — the failure is
  silent and looks correct in review unless the reader is looking for it. A lint
  rule, or a test that walks the route table and asserts every body parameter
  carries a pipe, would close it and does not exist yet.
- `packages/shared` must stay framework-free to keep this working. It currently
  depends only on `zod`; adding a Nest or Prisma import there would break both
  the browser consumer and the JSON Schema export.
- **The frontend does not import these schemas yet.** `apps/web` has no
  dependency on `@nahuat/shared` — it is a landing page plus the Auth0 flow, and
  no typed API call exists in it. Comments in the pipe describe the schemas as
  "the contract the frontend imports," which states the intent rather than the
  present state. The design only pays off once the web app actually consumes
  them.
- No generated API documentation until the OpenAPI work is done. A DTO-based
  project would have had Swagger UI for the cost of one module.
- Validation errors are uniform across every route by construction, since they
  are produced in one place rather than per handler.

## Alternatives considered

**`class-validator` DTOs — the NestJS convention.** Rejected as above: a second
definition of every payload, unusable by the frontend, drifting invisibly from
the first. It also puts `class-transformer` on the request path, where correct
behaviour depends on `transform` and `whitelist` being set as intended rather
than on the schema itself.

**`nestjs-zod`.** Wraps Zod in a Nest-idiomatic pipe and produces Swagger
metadata, which would recover the documentation half of the convention.
Rejected because it inserts a third-party layer between two things this project
already controls, and pins the Zod version to whatever that layer supports —
for a benefit `z.toJSONSchema()` now provides natively.

**A global `ZodValidationPipe` driven by a `@Schema()` metadata decorator.**
Keeps one registration in `AppModule` and moves the schema onto handler
metadata. Rejected as an indirection that buys nothing: it re-implements the
parameter binding Nest already provides, and per-parameter application is the
documented way to attach a pipe to one argument. It would not fix the
enforcement gap above either, since the decorator can be forgotten exactly as
the pipe can.

**Validating inside services instead of at the boundary.** Rejected because it
puts the decision to return 400 inside business logic, repeats it in every
service, and leaves controllers accepting `unknown`.
