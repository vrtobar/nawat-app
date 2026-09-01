"""Validation against the schemas generated from packages/shared.

ADR 10 made one definition the rule for payload shapes. A language boundary is
exactly where that rule is usually abandoned and two hand-written halves start
drifting; generating this side from the Zod source is what keeps it.
"""

import json
from functools import cache
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema import ValidationError as JsonSchemaValidationError

from . import config
from .errors import TerminalError


@cache
def _validator(name: str) -> Draft202012Validator:
    schema = json.loads((Path(config.CONTRACTS_DIR) / name).read_text())
    return Draft202012Validator(schema)


def validate_message(payload: dict) -> None:
    """The message on the way IN.

    A message this consumer does not understand is terminal, not transient. The
    producer will not publish a different one on redelivery, so retrying only
    delays the dead-letter queue by three visibility timeouts.
    """
    try:
        _validator("media-processing-message.schema.json").validate(payload)
    except JsonSchemaValidationError as err:
        raise TerminalError(f"message does not match the contract: {err.message}") from err


def validate_derivatives(derivatives: dict) -> None:
    """What this consumer writes, on the way OUT.

    Checked before the row is updated rather than after, because the reader is
    the approval gate — a different language, a different process, and by the
    time it meets a bad shape a reviewer is already looking at the asset.
    """
    try:
        _validator("media-derivatives.schema.json").validate(derivatives)
    except JsonSchemaValidationError as err:
        raise TerminalError(f"derivatives do not match the contract: {err.message}") from err
