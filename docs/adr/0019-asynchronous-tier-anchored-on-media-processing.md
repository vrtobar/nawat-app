# 19. The asynchronous tier, anchored on media processing

- **Status:** Accepted; amended 2026-08-31. **Read "Amendment: the producer is
  the API, not S3" at the end before treating the Decision below as the shape
  being built** — one element of the topology changed.
- **Date:** 2026-08-28
- **Applies to:** `apps/workers/`, the unbuilt `modules/messaging`, and
  `modules/monitoring`
- **Depends on:** [ADR 11](0011-polyglot-workers-and-packaging.md) for worker
  language and packaging
- **Partly supersedes:** [ADR 11](0011-polyglot-workers-and-packaging.md) — the
  set of consumers it describes, not its packaging or language reasoning

This record describes work that does not exist yet. It is the shape the
asynchronous tier will be built to, not a description of anything running.

## Context

Four SQS consumers have existed as skeletons since before the dictionary was
built: `audit-consumer`, `cache-invalidation-consumer`,
`cdn-invalidation-consumer` and `lesson-completion-consumer`. Each is 26 to 48
lines, each ends in `throw new Error('not implemented')`, and none has a queue
to read, a repository to push to, or a runtime. There is no `modules/messaging`;
no `aws_sqs` or `aws_lambda` resource exists in any environment.

The tier was designed before the domain was understood, and the domain has since
argued against three of the four:

- **Audit writes belong in the transaction that produced them.** A dropped queue
  message leaves an edit with no trace, which is the exact failure the audit
  table exists to prevent. Asynchronous delivery weakens the record it is meant
  to create.
- **A CloudFront invalidation is one API call.** A queue buys retry and
  decoupling for an operation that is neither hot nor failure-sensitive, and
  the consumer would need network placement decided for it besides.
- **Cache invalidation serves a cache nothing reads.** ElastiCache runs in both
  environments and no client library is installed anywhere in the repository.

That leaves `lesson-completion`, whose own comment scopes it to SRS card
seeding, activity logging, and streak recalculation for a content hierarchy that
is not built. Examined individually those three do not behave alike: **seeding a
learner's cards cannot lag.** A user finishing a lesson and finding nothing
scheduled is the same silent failure as a dropped audit write, and the work is a
single batched transaction measured in milliseconds. Streaks and activity
logging can lag without anyone noticing.

So the strongest surviving justification splits, and the compelling half belongs
in the request path.

**Media processing is the workload that does not.** The schema already carries
`Entry.imageKey` and `Translation.audioKey`, both commented as the source of
truth for file location; the assets bucket exists in the foundation layer behind
CloudFront; `CDN_URL` is validated at API boot; and `POST /uploads/presign` is
specified. Two exercise types — `LISTEN_SELECT` and `LISTEN_TYPE` — require
audio on their target, so recordings are load-bearing for the learning domain
rather than decorative. Nothing processes any of it.

Transcoding cannot run in a request. It is variable in duration, fails for
reasons worth retrying, and operates on files rather than rows.

## Decision

- **Delete `audit-consumer`, `cache-invalidation-consumer` and
  `cdn-invalidation-consumer`.** Their reasons have been argued away above.
  Keeping skeletons that will be rewritten is not preparation; it is a guess
  carried as though it were a decision, and it is how `modules/monitoring` came
  to specify DLQ alarms for four queues that will not all exist.
- **Media processing is the first queue built, and the tier's anchor.**
  ~~`S3 event → SQS → Lambda`~~ — **the producer changed; see the amendment.**
  The reasoning that follows is untouched by it: rather than S3 invoking Lambda
  directly, the queue is what supplies retry with a dead-letter destination,
  which is the property that makes this asynchronous rather than merely
  deferred.
- **Keep `lesson-completion-consumer`, re-scoped.** It carries the side effects
  that may lag — activity logging, streak and XP recalculation. **SRS card
  seeding stays synchronous**, in the transaction that records the completion.
- **Queues follow workloads.** The four-queue layout in the planning documents
  is not a target. A queue is added when a job needs durability and retry, and
  the DLQ alarms in `modules/monitoring` are scoped to the queues that exist.
- **Audit writes are synchronous**, in the same transaction as the change they
  describe. See [ADR 20](0020-media-assets-provenance-and-the-approval-gate.md)
  for the media half of what that implies.

## Consequences

- **[ADR 11](0011-polyglot-workers-and-packaging.md) gains the technical anchor
  it lacked and loses its consumer list.** That record is candid that no defect
  prompted the choice of Python. Media processing supplies one: loudness
  normalisation, transcoding and image derivation are that ecosystem's ordinary
  work, and an `ffmpeg` binary cannot ship in a zip — which turns its container
  packaging decision from convenient into required. Its allocation of three
  consumers to Python no longer applies, since those consumers are being
  deleted.
- **`modules/monitoring` shrinks.** Its Lambda and DLQ alarms were written for
  four queues. They are scoped to what exists, which today is none and shortly
  will be one.
- **ElastiCache still has no consumer.** Removing `cache-invalidation-consumer`
  does not decide whether the cache itself stays; it removes a consumer that
  would have invalidated a cache nothing reads. That decision is separate and
  still open.
- **`AuditLog.sqsMessageId` becomes dead.** The column exists for idempotency in
  a consumer that will not be built. It is left in place until the audit write
  path is implemented, at which point it is dropped in the same migration.
- **The tier stays small enough to justify per queue.** The cost of this
  decision is that a second workload needing a queue has to make its own case,
  rather than inheriting an existing pipeline.

## Alternatives considered

- **Build the tier as planned, with four queues.** Rejected because three of the
  four consumers have no work to do, and two are better synchronous. Building
  infrastructure for jobs that will be deleted spreads the mistake into IAM,
  packaging, and alarm configuration — which is what already happened to
  `modules/monitoring`.
- **Delete the asynchronous tier entirely and add queues when needed.** Rejected
  because media processing is a real workload with a real need, arriving on a
  schedule, and deleting the tier would strand ADR 11 rather than resolve it.
  The objection this answers is that "nothing needs it today" is a statement
  about the calendar, not the design.
- **`S3 → Lambda` directly, with no queue.** Rejected: Lambda's own retry and
  failure destinations are weaker than a queue's, and the reason to be
  asynchronous here is precisely that a transcode should be retried and, if it
  keeps failing, land somewhere a human will look.
- **Keep the three skeletons as documentation of intent.** Rejected: they read
  as decisions rather than as sketches, and downstream records treated them that
  way. The intent is recorded here instead, where it can be argued with.

## Amendment: the producer is the API, not S3

**2026-08-31, before any of this was built.** The Decision above specifies
`S3 event → SQS → Lambda`. The queue stays, the consumer stays, and the
argument against invoking Lambda directly stands. What changes is who publishes:
the API, from the upload-completion call, rather than an S3 bucket notification.

**What this record did not have when it was written.** ADR 20 was accepted the
same day and built the following one, and it introduced a state this record does
not mention: `AWAITING_UPLOAD`, distinct from `PENDING`. The reason is recorded
on the enum — this record makes an asset stuck in `PENDING` a _monitored_
condition, the signal that a queue or a consumer is broken, and abandoned
uploads are common enough to drown that signal from the first day. So `PENDING`
was narrowed to mean exactly "queued and unprocessed".

**That narrowing is what decides the producer.** S3 fires when bytes land, which
happens for abandoned uploads too — a contributor who uploads and closes the
tab never calls the completion endpoint, and their object is indistinguishable
at the bucket from one that was confirmed. Under an S3 notification the consumer
would process an asset still in `AWAITING_UPLOAD`, which either bypasses the
state machine the API exists to enforce or burns three receives into the
dead-letter queue for an event that is not an error. Worse, the reaper is
specified to delete abandoned `AWAITING_UPLOAD` rows and their objects, so it
would eventually destroy an asset the consumer had already processed. Two
components, each behaving correctly, disagreeing about what a row is.

Publishing from the completion call removes the class rather than handling it.
No completion, no message, nothing processed, and the reaper collects the row
exactly as designed. The message carries the asset id instead of a key to be
parsed back into one, and the state machine remains the only thing that decides
what gets worked on.

**A secondary benefit, not the reason.** S3 notification delivery is
"typically in seconds, but can sometimes take a minute or longer" and is not
ordered, so a notification could arrive before the completion call had written
`PENDING`. That race is self-healing — the consumer throws, SQS redelivers — and
it is not what motivates this change. The abandoned upload is.

### What it costs

**A dual write.** The `PENDING` update commits and the publish then fails,
leaving a row that will never be processed and no message to process it. This
is now the only way media gets stuck, and it is a genuine cost: an S3
notification, once configured, does not fail this way.

The answer is a sweep the design already required for another reason. A reaper
is specified for abandoned `AWAITING_UPLOAD` rows; finding `PENDING` rows older
than a threshold and **republishing** them is a second query on the same
schedule. It ships with the queue rather than after it, because until it exists
the failure it covers is silent.

That also answers a question the backlog left open — whether a stuck `PENDING`
is the same class of thing as an abandoned upload. It is not. An abandoned
upload is deleted; a stuck `PENDING` means a lost publish or a broken consumer,
so it is republished and, if it persists, alarmed. Deleting it would remove the
evidence of the failure this record wants monitored.

### Ordering

The publish happens after the `PENDING` write commits. Publishing inside the
transaction would let a consumer read the row before it is visible and see
`AWAITING_UPLOAD` — the same race, reintroduced by construction rather than by
chance.

### Consequences

- **No `aws_s3_bucket_notification` anywhere.** The assets bucket lives in the
  foundation layer and the queue in the application layer; a notification
  spanning them would have coupled a resource that survives teardown to one that
  does not. That coupling simply does not arise now.
- **The message shape is ours**, so the contract question in ADR 11's
  consequences becomes live: what crosses the language boundary is a shape this
  repository defines, generated for the Python side rather than transcribed.
- **`apps/api` gains an SQS client and the IAM to use it.** The API was
  previously a producer of nothing.
