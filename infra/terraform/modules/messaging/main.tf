# =============================================================================
# MODULE: MESSAGING
#
# The first queue in this repository, and deliberately the only one. ADR 19
# scopes the asynchronous tier to media processing and states the rule that got
# it there: queues follow workloads, so a second workload makes its own case
# rather than inheriting this pipeline.
#
# Lives in the application layer, so a teardown takes it with the rest. Nothing
# durable is lost — the queue holds work in flight, and the row it refers to is
# in a database that does not survive a teardown either.
#
# THE PRODUCER IS THE API, not an S3 bucket notification. ADR 19's amendment
# has the reasoning; the consequence for this file is that no
# aws_s3_bucket_notification exists, and so nothing here reaches across into
# the foundation layer that owns the bucket.
# =============================================================================

# The dead-letter queue is declared first because the main queue's redrive
# policy names it, and reading them in this order matches the dependency.
#
# FOURTEEN DAYS, the maximum. A message arrives here because it failed three
# times, which is a thing a person investigates rather than a thing that
# resolves itself; the retention is how long they have to do it. It costs
# nothing — SQS bills on requests, not on stored messages.
resource "aws_sqs_queue" "media_dlq" {
  name                      = "${var.prefix}-media-dlq"
  message_retention_seconds = 1209600

  # Free, and on by default for queues created in the console — Terraform's
  # default is off, which is the only reason this line exists. The payload is
  # an asset id rather than anything sensitive, so this is defence in depth.
  sqs_managed_sse_enabled = true

  tags = { Name = "${var.prefix}-media-dlq" }
}

# STANDARD, NOT FIFO. Media jobs have no ordering relationship with each other
# — two contributors uploading at the same time are unrelated events — and FIFO
# would cap throughput to buy a guarantee nothing needs. The cost is
# at-least-once delivery, which is why the consumer is required to be
# idempotent rather than merely expected to be.
resource "aws_sqs_queue" "media" {
  name = "${var.prefix}-media"

  # ⚠️ MUST EXCEED THE CONSUMER'S FUNCTION TIMEOUT, or SQS makes the message
  # visible again while the Lambda still holds it and a second invocation
  # transcodes the same object concurrently. That failure does not surface as
  # an error: both invocations succeed, and the derivatives are simply written
  # twice. The consumer's timeout is var.consumer_timeout_seconds and this is
  # derived from it rather than set independently, so the two cannot drift.
  visibility_timeout_seconds = var.consumer_timeout_seconds + 60

  # Long polling. Without it a receive returns immediately and empty, which
  # costs a request per poll for no work.
  receive_wait_time_seconds = 20

  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true

  # THREE ATTEMPTS. A transcode fails for one of two reasons: something
  # transient (S3 or the database briefly unavailable), which a retry fixes, or
  # the file itself, which no number of retries fixes. Three covers the first
  # without turning the second into a twenty-minute delay before anyone is told.
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.media_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Name = "${var.prefix}-media" }
}
