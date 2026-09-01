# =============================================================================
# THE REAPER
#
# Republishes PENDING assets whose message was lost, and collects uploads that
# were presigned and never confirmed.
#
# THE SAME IMAGE AS THE CONSUMER, a different CMD, and A DIFFERENT ROLE. The
# image is shared because the dependencies and database helpers are identical
# and a second repository would buy a name. The role is not, because this
# function holds s3:DeleteObject on source/* — the grant deliberately absent
# from the API task role — and keeping it away from the request path is the
# entire reason the reaper is a separate thing. Sharing the role would quietly
# undo the separation that motivates it.
# =============================================================================

data "aws_iam_policy_document" "reaper_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "reaper" {
  name               = "${var.prefix}-media-reaper"
  description        = "Assumed by the media reaper. Holds the only DeleteObject grant on source/*."
  assume_role_policy = data.aws_iam_policy_document.reaper_assume.json
}

resource "aws_iam_role_policy_attachment" "reaper_vpc" {
  role       = aws_iam_role.reaper.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "reaper" {
  # ⚠️ THE ONE GRANT THIS ROLE EXISTS FOR. Delete only, on source/* only. No
  # GetObject — the reaper never reads an original, it removes one whose row
  # says it was never claimed. No access to pending/ or public/ at all:
  # derivatives are the consumer's to write and the gate's to publish, and
  # nothing about an abandoned upload requires touching either.
  statement {
    sid       = "CollectAbandonedOriginals"
    effect    = "Allow"
    actions   = ["s3:DeleteObject"]
    resources = ["${var.assets_bucket_arn}/source/*"]
  }

  # A producer here, not a consumer. No ReceiveMessage: reading the queue is
  # the consumer's job, and competing for messages with it is not this
  # function's business.
  statement {
    sid       = "RepublishLostWork"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.media.arn]
  }

  statement {
    sid       = "ReadDatabaseCredentials"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_secret_arn]
  }

  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.reaper.arn}:*"]
  }
}

resource "aws_iam_role_policy" "reaper" {
  name   = "${var.prefix}-media-reaper"
  role   = aws_iam_role.reaper.id
  policy = data.aws_iam_policy_document.reaper.json
}

resource "aws_cloudwatch_log_group" "reaper" {
  name              = "/aws/lambda/${var.prefix}-media-reaper"
  retention_in_days = var.log_retention_days

  tags = { Name = "${var.prefix}-media-reaper" }
}

resource "aws_lambda_function" "media_reaper" {
  function_name = "${var.prefix}-media-reaper"
  role          = aws_iam_role.reaper.arn

  package_type  = "Image"
  image_uri     = "${var.ecr_media_consumer_url}:${var.image_tag}"
  architectures = ["arm64"]

  # Overrides the image's CMD, and is what makes one image serve two functions.
  # Without it both would start the consumer handler.
  image_config {
    command = ["media_consumer.reaper.handler"]
  }

  # Two queries and a bounded batch of deletes. Nothing here decodes media, so
  # it gets a fraction of the consumer's memory — and since memory sets the CPU
  # share, a fraction of its cost per second.
  timeout     = var.reaper_timeout_seconds
  memory_size = var.reaper_memory_mb

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_sg_id]
  }

  environment {
    variables = {
      ASSETS_BUCKET   = var.assets_bucket_name
      MEDIA_QUEUE_URL = aws_sqs_queue.media.url
      DB_SECRET_ARN   = var.db_secret_arn
      DB_HOST         = var.db_host
      DB_PORT         = tostring(var.db_port)
      DB_NAME         = var.db_name

      STALE_PENDING_MINUTES  = tostring(var.stale_pending_minutes)
      ABANDONED_UPLOAD_HOURS = tostring(var.abandoned_upload_hours)
    }
  }

  depends_on = [
    aws_iam_role_policy.reaper,
    aws_iam_role_policy_attachment.reaper_vpc,
    aws_cloudwatch_log_group.reaper,
  ]

  tags = { Name = "${var.prefix}-media-reaper" }
}

# -----------------------------------------------------------------------------
# SCHEDULE
#
# Every fifteen minutes, which is a correctness choice rather than a cost one:
# the run is two queries that usually return nothing, at roughly two percent of
# the Lambda free tier's compute. The interval is how long an upload may stay
# stuck before anyone would notice, not what the bill can bear.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "reaper" {
  name                = "${var.prefix}-media-reaper"
  description         = "Republishes lost media jobs and collects abandoned uploads"
  schedule_expression = var.reaper_schedule

  tags = { Name = "${var.prefix}-media-reaper" }
}

resource "aws_cloudwatch_event_target" "reaper" {
  rule = aws_cloudwatch_event_rule.reaper.name
  arn  = aws_lambda_function.media_reaper.arn
}

# EventBridge invokes through a resource policy on the function rather than by
# assuming a role. Without this the rule fires on schedule and is silently
# denied — the failure is an absence of logs, which is a hard thing to notice.
resource "aws_lambda_permission" "reaper_schedule" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.media_reaper.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.reaper.arn
}
