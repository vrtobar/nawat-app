"""Postgres access: literal SQL, no ORM, no generated client.

ADR 11 puts this consumer in Python because it writes a fixed shape and never
reads the model. That is only true while this file stays a handful of
statements — the moment it needs to join or to know about a field it did not
write, the argument that put it here has stopped applying.

⚠️ THE COLUMNS BELOW ARE DECLARED IN schema.prisma AND CREATED BY A PRISMA
MIGRATION. Nothing in this package can see that. A rename there is invisible
here until it fails at runtime; ADR 12 records the same ownership split.
"""

import json
from typing import Any

import boto3
import psycopg

from . import config
from .errors import TransientError

_connection: psycopg.Connection | None = None


def _credentials() -> dict[str, str]:
    secret = boto3.client("secretsmanager").get_secret_value(SecretId=config.DB_SECRET_ARN)
    return json.loads(secret["SecretString"])


def connection() -> psycopg.Connection:
    """One connection per container, reused across invocations.

    Lambda freezes a container between invocations rather than tearing it down,
    so opening a connection per invocation would pay the TLS and auth cost on
    every message and hold far more Postgres connections than the work needs.
    A frozen connection can still be dropped by the server, so a closed one is
    reopened rather than assumed good.
    """
    global _connection
    if _connection is None or _connection.closed:
        creds = _credentials()
        try:
            _connection = psycopg.connect(
                host=config.DB_HOST,
                port=config.DB_PORT,
                dbname=config.DB_NAME,
                user=creds["username"],
                password=creds["password"],
                autocommit=True,
                connect_timeout=10,
            )
        except psycopg.Error as err:
            raise TransientError(f"could not connect to the database: {err}") from err
    return _connection


def load_asset(asset_id: str) -> dict[str, Any] | None:
    with connection().cursor() as cur:
        cur.execute(
            """
            SELECT id, kind, status, source_key, content_type, attempts
            FROM media_assets
            WHERE id = %s
            """,
            (asset_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "kind": row[1],
        "status": row[2],
        "source_key": row[3],
        "content_type": row[4],
        "attempts": row[5],
    }


def increment_attempts(asset_id: str) -> int:
    """Count this receive, and return the new total.

    Incremented BEFORE the work rather than after it, so an invocation that
    dies without unwinding — an out-of-memory kill, a timeout — is still
    counted. A counter that only records tidy failures would never reach the
    ceiling in the cases the ceiling exists for.
    """
    with connection().cursor() as cur:
        cur.execute(
            "UPDATE media_assets SET attempts = attempts + 1 WHERE id = %s RETURNING attempts",
            (asset_id,),
        )
        return cur.fetchone()[0]


def mark_ready(asset_id: str, derivatives: dict[str, Any]) -> None:
    """The only success path.

    Clears `error` too, so an asset that fails once and succeeds on redelivery
    does not carry the earlier message into the review queue.
    """
    with connection().cursor() as cur:
        cur.execute(
            """
            UPDATE media_assets
            SET status = 'READY', derivatives = %s, error = NULL
            WHERE id = %s
            """,
            (json.dumps(derivatives), asset_id),
        )


def mark_failed(asset_id: str, error: str) -> None:
    # Truncated because `error` is rendered in the review queue and a stack
    # trace from ffmpeg can run to kilobytes. The full text is in the logs.
    with connection().cursor() as cur:
        cur.execute(
            "UPDATE media_assets SET status = 'FAILED', error = %s WHERE id = %s",
            (error[:1000], asset_id),
        )


# -----------------------------------------------------------------------------
# THE REAPER'S QUERIES
# -----------------------------------------------------------------------------


def stale_pending(older_than_minutes: int, limit: int) -> list[str]:
    """Assets queued but never picked up — the lost-publish case.

    `attempts = 0` IS THE IMPORTANT CLAUSE. A row the consumer has already
    received has attempts >= 1, and its fate belongs to the consumer's own
    ceiling; republishing it would push it toward that ceiling faster than its
    receives justify and turn a slow asset into a failed one.
    """
    with connection().cursor() as cur:
        cur.execute(
            """
            SELECT id
            FROM media_assets
            WHERE status = 'PENDING'
              AND attempts = 0
              AND updated_at < now() - make_interval(mins => %s)
            ORDER BY updated_at
            LIMIT %s
            """,
            (older_than_minutes, limit),
        )
        return [row[0] for row in cur.fetchall()]


def abandoned_uploads(older_than_hours: int, limit: int) -> list[tuple[str, str]]:
    """Rows created by a presign whose bytes never arrived, or never got confirmed.

    ATTACHED ASSETS ARE EXCLUDED. Attachment is independent of processing state
    — an AWAITING_UPLOAD asset can legitimately be attached to an entry — and
    both foreign keys are onDelete: Restrict, so a delete would fail anyway.
    Excluding them here means the reaper does not spend every run colliding
    with a constraint that is doing its job.
    """
    with connection().cursor() as cur:
        cur.execute(
            """
            SELECT m.id, m.source_key
            FROM media_assets m
            WHERE m.status = 'AWAITING_UPLOAD'
              AND m.created_at < now() - make_interval(hours => %s)
              AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.image_asset_id = m.id)
              AND NOT EXISTS (SELECT 1 FROM translations t WHERE t.audio_asset_id = m.id)
            ORDER BY m.created_at
            LIMIT %s
            """,
            (older_than_hours, limit),
        )
        return [(row[0], row[1]) for row in cur.fetchall()]


def delete_asset(asset_id: str) -> None:
    """Removes the row. The object is deleted first — see reaper.collect_abandoned."""
    with connection().cursor() as cur:
        cur.execute(
            "DELETE FROM media_assets WHERE id = %s AND status = 'AWAITING_UPLOAD'",
            (asset_id,),
        )
