"""Runtime configuration, read once per container rather than per invocation."""

import os

# Where the source object lives and the derivatives are written. One bucket,
# three prefixes; this consumer reads `source/` and writes `pending/` and has
# IAM for nothing else.
ASSETS_BUCKET = os.environ["ASSETS_BUCKET"]

# The RDS master secret. Read through the Secrets Manager API at cold start
# rather than injected as an environment variable, which would put the password
# in function configuration where anyone with GetFunctionConfiguration can read
# it.
DB_SECRET_ARN = os.environ["DB_SECRET_ARN"]
DB_HOST = os.environ["DB_HOST"]
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ["DB_NAME"]

# ⚠️ MUST MATCH maxReceiveCount ON THE QUEUE'S REDRIVE POLICY. The two are
# different mechanisms for the same ceiling: this one gives up in a way that
# leaves an explanation on the row, the redrive policy gives up in a way that
# preserves the message. If this were the larger of the two the queue would
# win, messages would dead-letter, and the `attempts` column would never reach
# the number that makes it useful.
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "3"))

# Generated from the Zod definitions in packages/shared. See
# scripts/generate-contracts.ts there.
CONTRACTS_DIR = os.environ.get("MEDIA_CONTRACTS_DIR", "/var/task/contracts")

# -----------------------------------------------------------------------------
# AUDIO
# -----------------------------------------------------------------------------

# EBU R128 integrated loudness, in LUFS. -16 rather than broadcast's -23
# because this is played through a phone speaker in a browser.
#
# The reason it matters here more than it would elsewhere: recordings arrive
# from different speakers, rooms and devices over years, and without
# normalisation a learner moving through flashcards gets a volume jump on every
# card. That is the difference between a dictionary that feels finished and one
# that feels assembled.
LOUDNESS_TARGET_LUFS = float(os.environ.get("LOUDNESS_TARGET_LUFS", "-16.0"))
LOUDNESS_TRUE_PEAK_DB = -1.5
LOUDNESS_RANGE = 11.0

# Mono, because these are single-word recordings of one person and stereo
# doubles the bytes to carry no information. 96kbps is generous for speech at
# one channel.
AUDIO_BITRATE = "96k"

# -----------------------------------------------------------------------------
# IMAGES
# -----------------------------------------------------------------------------

# WebP only, with no JPEG fallback: it is universal in browsers that matter,
# and a fallback would double the file count for a case that does not arrive.
IMAGE_WIDTHS = (320, 640, 960)
IMAGE_PRIMARY_WIDTH = 640
IMAGE_QUALITY = 82

# -----------------------------------------------------------------------------
# THE REAPER
#
# Runs on a schedule in the same image, under a DIFFERENT execution role. That
# separation is the entire point: the reaper holds s3:DeleteObject on source/*,
# which is the one grant deliberately kept off the request path, so that a bug
# in an HTTP handler cannot reach an original recording.
# -----------------------------------------------------------------------------

# Where to republish a stale PENDING asset. The reaper is the API's counterpart
# as a producer, and the only other thing that writes to this queue.
MEDIA_QUEUE_URL = os.environ.get("MEDIA_QUEUE_URL", "")

# How long a PENDING row may sit untouched before it is assumed the publish was
# lost. Generous relative to the work — processing takes seconds — because the
# cost of republishing early is a duplicate message the consumer discards, and
# the cost of waiting is only that an asset is late.
STALE_PENDING_MINUTES = int(os.environ.get("STALE_PENDING_MINUTES", "15"))

# How long an upload may stay unclaimed before its row and object are removed.
# The presigned URL expires in five minutes, so anything past an hour is
# certainly abandoned; twenty-four is deliberately generous because deleting a
# recording is unrecoverable and the cost of waiting is a few kilobytes.
ABANDONED_UPLOAD_HOURS = int(os.environ.get("ABANDONED_UPLOAD_HOURS", "24"))

# Bounds the work in one run. A backlog is drained over several runs rather
# than in one invocation that might time out halfway through with no record of
# how far it got.
REAP_BATCH_LIMIT = int(os.environ.get("REAP_BATCH_LIMIT", "100"))
