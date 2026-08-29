# 20. Media assets: provenance, processing state, and the approval gate

- **Status:** Accepted
- **Date:** 2026-08-28
- **Applies to:** `packages/database/prisma/schema.prisma`, the unbuilt uploads
  and media modules, and the assets bucket in each foundation layer
- **Depends on:** [ADR 19](0019-asynchronous-tier-anchored-on-media-processing.md)
  for the processing pipeline, [ADR 17](0017-production-disposable-during-prelaunch.md)
  for what survives a teardown
- **Amended 2026-08-29:** the schema, the upload path, attachment and the
  approval gate are built. **Read "Amendment: what actually shipped" at the end
  before treating the Decision below as a description of the running system** —
  four things differ, and one of them is a state this record does not mention.

~~This record describes work that does not exist yet.~~ It did when it was
written. The processing pipeline it depends on is still unbuilt; everything
either side of it is not.

## Context

`Entry.imageKey` and `Translation.audioKey` are nullable strings, each commented
as the source of truth for a file's location. `imageUrl` and `audioUrl` sit
beside them. Nothing writes any of the four, and nothing processes an upload.

Three things make the naive shape — set the URL when the file arrives —
insufficient.

**Processing is asynchronous, so there is a window where a row points at media
that is not ready.** If the URL is written optimistically at upload time, a
failed transcode leaves an entry that appears to have audio and does not. That
failure is silent by construction: nothing is broken enough to raise an error,
and the only way to find it is for a person to click play.

**Provenance is part of the artefact's value.** Nawat has roughly one hundred
speakers. Who recorded a word, when, in which dialect, and under what
understanding is not incidental metadata — it is much of what makes a recording
worth keeping, and being able to inspect or sort contributions by speaker is a
requirement rather than a convenience. None of that fits beside a URL.

**Documenting a word and recording it are separate acts, often by different
people.** The contributor who knows a word's meaning and the speaker who can
pronounce it authentically need not be the same person, and rarely will be.

Finally, everything reaching the public is to pass an ADMIN gate. Entries
already work this way; media has no equivalent.

## Decision

- **A `MediaAsset` table, not status columns on the existing fields.** It
  carries `kind` (audio or image), processing `status`, the uploaded
  `sourceKey`, the processed `derivatives`, `error` and `attempts` for retries,
  and the provenance the recording is worth keeping — who supplied it and when.
  `Translation.audioAssetId` and `Entry.imageAssetId` reference it.
- **Both kinds are processed by one pipeline, and images are not a later
  addition.** Audio is normalised for loudness across contributors recording on
  different equipment, trimmed of leading and trailing silence, transcoded to a
  web-delivered format, and measured for duration. Images are resized to a small
  set of widths and converted to a modern format.
  - ⚠️ **EXIF is stripped, and that is a privacy measure rather than a size
    optimisation.** Photographs carry GPS coordinates by default. A project
    documenting a language spoken in identifiable communities must not publish a
    contributor's location as a side effect of their uploading a picture, and
    the metadata survives every naive copy of a file.
- **Media is a sub-resource, not a field of an entry.** It is attached after
  creation, through its own endpoint, never through the entry's `PATCH`.
  Consequently attaching a recording does not touch the entry's `updatedAt` and
  does not contend with its optimistic lock, so a recording and a typo fix can
  land at the same time; the speaker is recorded on the asset rather than
  becoming the entry's `updaterId`; and the audit record reads "recording added"
  rather than "entry edited".
- **Processing state and review state are separate, and neither implies the
  other.** Processing is `PENDING → READY | FAILED` and is decided by the
  pipeline. Review is `isPublished`, settable only by an ADMIN, matching how
  entries already publish. A recording may be READY and unapproved; it can never
  be approved while PENDING.
- **`audioUrl` and `imageUrl` are written only when an ADMIN publishes the
  asset.** A populated URL therefore asserts three things at once: processed,
  verified retrievable, and approved. Nothing else writes those columns —
  presign does not, upload does not, and the processor does not. Unpublishing
  clears them; a FAILED asset never receives one.
- **Publication is a move between prefixes, not a flag.** Derivatives are
  written to a `pending/` prefix; approval copies them to the `public/` prefix
  that the CloudFront origin path covers. Admin review plays a recording through
  a short-lived presigned URL, never through the CDN.
- **The processor verifies before it reports success.** It retrieves the object
  it has just written before marking an asset READY, so "the write returned
  without error" is not accepted as evidence that the file is there.
- **An asset that stays PENDING is a monitored condition.** A queue that is
  misconfigured or a consumer that is broken leaves assets pending indefinitely
  and reports nothing, which is the silent version of the failure this record
  exists to prevent.

## Consequences

- **The public read path stays a single query and cannot leak.** It reads
  `audioUrl` and joins nothing, and because that column is only ever written on
  approval, unprocessed, failed and unreviewed media are unreachable through it
  by construction rather than by a filter someone has to remember.
- **Unapproved media is unreachable, not merely unlinked.** Keeping every
  derivative in one prefix and relying on unguessable keys would make the gate a
  convention rather than a boundary; the prefix split is what makes it real.
- **A contributor may add a recording to a published entry.** The service
  refuses edits to published entries from non-ADMINs, and under a `PATCH` model
  that rule would have forbidden exactly the contribution most wanted — a
  recording for a word already public. As a sub-resource it is not an edit, and
  the ADMIN gate on publication is what keeps quality control intact.
- **Editorial review stops being optional.** The gate needs, at minimum, a queue
  of approved-pending assets. Recording why something was rejected can come
  later, but without it the same recording is re-reviewed indefinitely.
- **Two writes exist where one did.** Creating an entry and attaching its media
  are separate operations. This is the cost of the asynchronous pipeline being
  visible in the API rather than hidden behind an endpoint that pretends to be
  synchronous.
- **Deleting an entry no longer disposes of its media.** Objects in the assets
  bucket outlive the rows that referenced them, and reclaiming them is its own
  job. The assets bucket is in the foundation layer and survives a teardown that
  destroys the database, so orphaned objects accumulate across environment
  rebuilds.

## Alternatives considered

- **A status enum on `audioKey` / `imageKey`.** Smaller today, and it would need
  migrating into a table later — a data migration over real recordings, which is
  the expensive kind. Derivatives are plural, retries need state, and provenance
  has nowhere to live in a nullable string.
- **Attaching media during entry creation.** Rejected because processing is
  asynchronous: such an endpoint would either block on the pipeline or create
  the entry pointing at media that is not ready, reintroducing the state this
  record exists to prevent. It also strands uploads that never find an entry.
- **Publishing as a flag, leaving files where they were written.** Rejected: the
  bucket is served publicly through CloudFront, so an unapproved recording would
  remain retrievable by anyone holding its key.
- **Writing the URL when processing completes, and filtering on approval at read
  time.** Rejected: it makes every public read join the asset table and depends
  on every future query remembering the filter. The invariant is cheaper to keep
  than the discipline.

## Amendment: what actually shipped

_Added 2026-08-29, after the schema, the upload path, the sub-resource
attachment and the approval gate were built._ Four things differ from the
Decision above. Each is recorded with its reason, because in every case the
original had an argument behind it and the argument is the part worth keeping.

**What did not change is worth saying first**, since the list below is
necessarily about deviations: media is a sub-resource, processing state and
review state are separate, `audioUrl` and `imageUrl` are written only on
approval and by nothing else, and publication is a copy between prefixes
enforced by CloudFront's origin path and the bucket policy together. The
substance of this record is the running system.

### There is no structured speaker reference

**The Decision says provenance covers "who recorded a word, when, in which
dialect, and under what understanding", and the Context calls being able to
"inspect or sort contributions by speaker" a requirement rather than a
convenience.** What shipped is `uploaderId` and a free-text `notes` column.

**The argument that removed it.** A foreign key to `users` cannot represent the
people who matter most here. A language with roughly a hundred speakers is
documented largely by recording elders who will never hold an account, so the
column would have been null for the majority of exactly the provenance this
record calls essential. The alternative considered was a small `Speaker` table,
which represents them properly and is what a later version should have.

**What it costs, stated plainly:** provenance is read rather than queried.
Sorting a contributor's recordings by who is heard in them is not possible, and
free text does not sort — names vary and are misspelled. If that becomes a real
need, the fix is a `Speaker` table and a migration over real recordings, which
this record elsewhere calls the expensive kind. The judgement was that
recordings accumulate slowly enough for that to stay affordable, and that a
half-typed provenance model — some fields structured, the rest prose — is worse
than one honest free-text column.

### There is no recorded-at column either, and for a different reason

`recordedAt` was written, then removed before it shipped. The reason is not the
one above: a date has an obvious type and would have been easy to keep.

**It was removed for consistency.** Once the who and the where are prose, typing
the when alone buys a column nothing queries — no endpoint reads it, no view
sorts by it, and the review queue orders by `createdAt`. It would have been a
nullable column carried because it was planned rather than because anything used
it, which is the shape this project has already paid for twice: the orphaned
`nahuat/<env>/internal` secret, and an ElastiCache instance billed for months
with no client library installed.

**Cheap to reverse, and deliberately so.** Unlike the speaker question, adding
`recorded_at` later is an additive nullable column and a backfill of only the
rows anyone cares about — no relational restructuring, no data migration over
the whole table.

### The state machine has a fourth state

**The Decision specifies `PENDING → READY | FAILED`.** What shipped is
`AWAITING_UPLOAD → PENDING → READY | FAILED`.

The row is created at presign, before any bytes exist. A single `PENDING` would
therefore mean both "the browser has not uploaded yet" and "uploaded, waiting on
the processor" — and this record makes an asset stuck in `PENDING` a **monitored
condition**, the signal that a queue or a consumer is broken. Abandoned uploads
are common enough that they would have drowned that signal from the first day.

Split, `PENDING` means exactly "queued and unprocessed", and the abandoned set
becomes addressable in its own right: it is what a reaper needs in order to
reclaim orphaned objects, which is a job this record's Consequences already
anticipate.

### The derivatives contract is defined by the gate, not the processor

**This record describes `derivatives` without saying what is in it.** The
approval gate has to know — it decides what to copy and which file becomes the
public URL — and it shipped first, so the shape is defined in
`packages/shared/src/schemas/media.schema.ts` and the still-unbuilt consumer
must honour it.

Two properties of that shape are decisions rather than encoding details. **Keys
are stored relative to the asset's prefix**, so `pending/<id>/audio.mp3` and
`public/<id>/audio.mp3` are the same stored key under two prefixes — publication
is a prefix swap with nothing to parse or re-derive. And **the primary file is
named rather than inferred**: for audio there is one obvious answer and for
images there is not, so a gate that guessed would put a thumbnail on a
dictionary page the day someone reordered the list.

⚠️ **This is a contract with a consumer that does not exist**, and it has never
met one. The gate's own logic and ordering are covered by unit tests that seed
the column and a fake object store; that a real transcode produces a shape the
gate accepts is unverified, and the first run behind a live processor is where
that gets found out.

### Two smaller notes

**Publishing an unattached asset is refused.** The Decision does not address it.
Approval writes a URL onto a parent row, so an unattached asset has nowhere for
that URL to go — and a published asset visible to nobody is the kind of state
that is discovered months later.

**Replacing or removing approved media is ADMIN-only**, while adding media where
there is none stays open to any contributor, published parent included. That
second half is this record's stated goal. The first half is its logical
consequence rather than a new rule: live media passed a review, so unreviewing
it is a reviewer's decision.
