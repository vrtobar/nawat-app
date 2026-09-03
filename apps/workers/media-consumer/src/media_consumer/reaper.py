"""The scheduled sweep: republish what was lost, collect what was abandoned.

Two jobs that look similar and are not. One RECOVERS work, the other DESTROYS
data, and they are in the same function only because they read the same table
on the same schedule.

WHY IT IS NOT IN THE API. Collecting an abandoned upload means deleting an
object under `source/`, and that grant is deliberately absent from the API task
role — the original recording is the one artefact in this system that cannot be
regenerated, and no code answering an HTTP request has a reason to remove one.
Putting the sweep here keeps the delete off the request path, which is the
entire point rather than an implementation detail. It shares the consumer's
image because the dependencies and the database helpers are identical; it does
NOT share its execution role, which is what actually isolates the permission.

WHY THE REPUBLISH HALF EXISTS AT ALL. ADR 19's amendment moved the producer
from an S3 notification to the API, which removed a whole class of wrong
behaviour and introduced one failure in exchange: the PENDING write commits and
the publish then fails, leaving a row nothing will ever process. That is now the
only way media gets stuck, and this is what unsticks it. Without this the
amendment would have been a trade rather than an improvement.
"""

import time
from typing import Any

from . import config, db, observability, queue, storage
from .errors import TransientError

logger = observability.configure()


def handler(_event: Any = None, _context: Any = None) -> dict[str, int]:
    """Returns what it did, so a run that found nothing is distinguishable in the logs.

    That claim was previously false in the only place it mattered. The summary
    below was written at INFO under a root logger the Lambda runtime had left at
    WARNING, so every quiet run — which is almost all of them — left nothing
    behind at all. See `observability` for why.
    """
    started = time.monotonic()
    republished = republish_stale()
    collected = collect_abandoned()

    observability.log_event(
        logger,
        "media.reaped",
        republished=republished,
        collected=collected,
        elapsedMs=round((time.monotonic() - started) * 1000),
    )
    return {"republished": republished, "collected": collected}


def republish_stale() -> int:
    """Re-queues PENDING assets the consumer never received."""
    stale = db.stale_pending(config.STALE_PENDING_MINUTES, config.REAP_BATCH_LIMIT)
    if not stale:
        return 0

    # WARNING rather than INFO. Reaching here means a publish was lost, which
    # is a real fault even though it is recovered — if this line appears every
    # run, something is wrong with the producer rather than with one message.
    logger.warning("found %d PENDING asset(s) with no message; republishing", len(stale))

    republished = 0
    for asset_id in stale:
        try:
            queue.publish_media_processing(asset_id)
            republished += 1
        except TransientError:
            # One failure must not abandon the rest of the batch, and the next
            # run picks this up again — the row is untouched, so it is still
            # stale and still selected.
            logger.exception("could not republish %s", asset_id)
    return republished


def collect_abandoned() -> int:
    """Deletes uploads that were presigned and never confirmed.

    OBJECT FIRST, THEN ROW, and the order is load-bearing. Delete the row first
    and a failure afterwards leaves an object no record points at — invisible,
    permanent, and paid for. This way a failure between the two leaves a row
    whose object is already gone, which the next run selects again and
    finishes; deleting an absent S3 key succeeds, so the retry is harmless.
    """
    abandoned = db.abandoned_uploads(config.ABANDONED_UPLOAD_HOURS, config.REAP_BATCH_LIMIT)
    if not abandoned:
        return 0

    collected = 0
    for asset_id, source_key in abandoned:
        try:
            storage.delete_source(source_key)
            db.delete_asset(asset_id)
            collected += 1
        except TransientError:
            logger.exception("could not collect %s", asset_id)
    if collected:
        logger.info("collected %d abandoned upload(s)", collected)
    return collected
