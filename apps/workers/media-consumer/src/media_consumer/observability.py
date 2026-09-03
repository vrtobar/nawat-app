"""Logging setup, and the one line each invocation leaves behind.

⚠️ `logging.basicConfig()` DOES NOTHING IN LAMBDA, and that is why this module
exists. The runtime's bootstrap attaches a handler to the root logger before
importing any handler code, and basicConfig returns early when root already has
one — so the level it asks for is never applied, root stays at WARNING, and
every `logger.info` in this package is discarded before it is formatted.

The effect is worse than no logging, because the calls are there and read as
working. A successful invocation produced START, END and REPORT and nothing
else, and the run was legible only through its side effects: the row reaching
READY and objects appearing under `pending/`.

Setting the level on the package logger rather than on root is what makes it
independent of whatever the runtime did. Propagation carries the record to the
runtime's handler, which sits at NOTSET and passes everything.
"""

import json
import logging
import os
from typing import Any

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")


def configure() -> logging.Logger:
    """Sets the package logger's level and returns it. Idempotent."""
    logger = logging.getLogger("media_consumer")
    logger.setLevel(LOG_LEVEL)
    return logger


def log_event(logger: logging.Logger, event: str, **fields: Any) -> None:
    """Emits one JSON object as the whole message.

    JSON rather than a formatted sentence so CloudWatch Logs Insights can filter
    on a field without a `parse` expression written per query. The keys are
    camelCase to match the derivative manifest and the rest of the wire
    contracts, so one vocabulary describes the asset everywhere.
    """
    logger.info(json.dumps({"event": event, **fields}, separators=(",", ":")))
