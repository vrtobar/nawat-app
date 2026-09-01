"""S3 access, scoped to two prefixes and permitted to delete from neither.

The IAM this runs under grants GetObject on `source/*` and PutObject on
`pending/*`. It has no DeleteObject anywhere, matching the API task role for
the same reason: the source is the one artefact here that cannot be
regenerated, and nothing that processes a file needs to remove one.
"""

from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from . import config
from .errors import TerminalError, TransientError

_s3 = None


def client():
    global _s3
    if _s3 is None:
        # No explicit region or credentials: the default chain reads the
        # function's execution role, matching how the API's S3 and SQS clients
        # are constructed.
        _s3 = boto3.client("s3")
    return _s3


def download_source(source_key: str, destination: Path) -> None:
    try:
        client().download_file(config.ASSETS_BUCKET, source_key, str(destination))
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code")
        # A missing object will still be missing on redelivery. Anything else —
        # throttling, a 5xx, a network fault — is worth another attempt.
        if code in ("404", "NoSuchKey"):
            raise TerminalError(f"source object {source_key} does not exist") from err
        raise TransientError(f"could not read {source_key}: {err}") from err


def upload_derivative(key: str, path: Path, content_type: str) -> int:
    """Writes one derivative under `pending/` and returns its size.

    Overwriting is intended. Keys are deterministic, so a redelivered message
    rewrites the same objects rather than accumulating variants — which is what
    makes at-least-once delivery survivable without a dedupe table.
    """
    try:
        client().upload_file(
            str(path),
            config.ASSETS_BUCKET,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    except ClientError as err:
        raise TransientError(f"could not write {key}: {err}") from err
    return path.stat().st_size
