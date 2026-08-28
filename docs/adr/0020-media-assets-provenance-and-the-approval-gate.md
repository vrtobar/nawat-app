# 20. Media assets: provenance, processing state, and the approval gate

- **Status:** Accepted
- **Date:** 2026-08-28
- **Applies to:** `packages/database/prisma/schema.prisma`, the unbuilt uploads
  and media modules, and the assets bucket in each foundation layer
- **Depends on:** [ADR 19](0019-asynchronous-tier-anchored-on-media-processing.md)
  for the processing pipeline, [ADR 17](0017-production-disposable-during-prelaunch.md)
  for what survives a teardown

This record describes work that does not exist yet.

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
