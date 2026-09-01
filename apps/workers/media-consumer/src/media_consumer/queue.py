"""Publishing to the media queue.

The API is the normal producer (ADR 19's amendment). This is the other one:
the reaper republishing an asset whose original publish was lost, which is the
counterweight that makes that amendment's dual write survivable.
"""

import json

import boto3
from botocore.exceptions import ClientError

from . import config
from .errors import TransientError

# Must match MEDIA_PROCESSING_MESSAGE_VERSION in packages/shared. The generated
# contract pins it on the way in, so a mismatch here fails at the consumer
# rather than silently.
MESSAGE_VERSION = 1

_sqs = None


def client():
    global _sqs
    if _sqs is None:
        _sqs = boto3.client("sqs")
    return _sqs


def publish_media_processing(asset_id: str) -> None:
    try:
        client().send_message(
            QueueUrl=config.MEDIA_QUEUE_URL,
            MessageBody=json.dumps({"version": MESSAGE_VERSION, "assetId": asset_id}),
        )
    except ClientError as err:
        raise TransientError(f"could not queue {asset_id}: {err}") from err
