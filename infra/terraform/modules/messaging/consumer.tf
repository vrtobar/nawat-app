# =============================================================================
# THE MEDIA CONSUMER
#
# A container-image Lambda, because an ffmpeg binary does not fit zip packaging
# — which is what turns ADR 11's container decision from convenient into
# required.
#
# ⚠️ THE IMAGE MUST EXIST IN ECR BEFORE THIS APPLIES. The function is declared
# against a specific tag, so an apply naming one that was never pushed fails at
# create rather than at plan. Both deploy workflows push all three images
# before the infra job runs, which is what makes the ordering hold; an apply
# from a laptop against a commit CI never built will not.
# =============================================================================

# -----------------------------------------------------------------------------
# EXECUTION ROLE
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "consumer_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "consumer" {
  name               = "${var.prefix}-media-consumer"
  description        = "Assumed by the media consumer Lambda"
  assume_role_policy = data.aws_iam_policy_document.consumer_assume.json
}

# Creates and deletes the ENIs that VPC attachment requires. AWS-managed
# because the actions are fixed by the service and there is nothing here to
# scope — they are the price of being in the VPC at all.
resource "aws_iam_role_policy_attachment" "consumer_vpc" {
  role       = aws_iam_role.consumer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# THE SAME PREFIX SPLIT THE API TASK ROLE USES, and for the same reason. This
# role reads originals and writes derivatives, and it holds DeleteObject on
# nothing: the source is the one artefact here that cannot be regenerated, and
# a processor has no more business removing one than a request path does.
data "aws_iam_policy_document" "consumer" {
  statement {
    sid       = "ReadTheOriginal"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${var.assets_bucket_arn}/source/*"]
  }

  # Write only. It cannot read back what it wrote, which it never needs to, and
  # cannot touch `public/` at all — publication is the approval gate's, and
  # nothing that processes an upload should be able to reach an approved file.
  statement {
    sid       = "WriteDerivatives"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${var.assets_bucket_arn}/pending/*"]
  }

  # The queue this function is mapped to, and only that one. GetQueueAttributes
  # is what the event source mapping polls with.
  statement {
    sid    = "ConsumeTheMediaQueue"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.media.arn]
  }

  # One secret. Read at cold start; see the module's db.py for why it is not an
  # environment variable.
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
    resources = ["${aws_cloudwatch_log_group.consumer.arn}:*"]
  }
}

resource "aws_iam_role_policy" "consumer" {
  name   = "${var.prefix}-media-consumer"
  role   = aws_iam_role.consumer.id
  policy = data.aws_iam_policy_document.consumer.json
}

# -----------------------------------------------------------------------------
# LOGS
#
# Declared rather than left to Lambda's implicit creation, which makes a group
# with no retention — logs then accumulate forever at full price, and the bill
# is the only thing that ever mentions it.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "consumer" {
  name              = "/aws/lambda/${var.prefix}-media-consumer"
  retention_in_days = var.log_retention_days

  tags = { Name = "${var.prefix}-media-consumer" }
}

# -----------------------------------------------------------------------------
# THE FUNCTION
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "media_consumer" {
  function_name = "${var.prefix}-media-consumer"
  role          = aws_iam_role.consumer.arn

  package_type  = "Image"
  image_uri     = "${var.ecr_media_consumer_url}:${var.image_tag}"
  architectures = ["arm64"]

  timeout     = var.consumer_timeout_seconds
  memory_size = var.memory_mb

  # VPC-attached because it writes to RDS in a private subnet. S3 goes over the
  # gateway endpoint, which is free and already in modules/networking, so that
  # traffic never touches NAT. Secrets Manager and CloudWatch Logs do, since
  # interface endpoints are off in both environments — that is what the Lambda
  # security group's 443 egress is for now, having originally been written for
  # a CloudFront call by a consumer that no longer exists.
  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_sg_id]
  }

  environment {
    variables = {
      ASSETS_BUCKET = var.assets_bucket_name
      DB_SECRET_ARN = var.db_secret_arn
      DB_HOST       = var.db_host
      DB_PORT       = tostring(var.db_port)
      DB_NAME       = var.db_name
      # Must agree with the queue's maxReceiveCount. The consumer gives up in a
      # way that leaves an explanation on the row; the redrive policy gives up
      # in a way that preserves the message. If this were the larger of the two
      # the queue would always win and `attempts` would never reach the number
      # that makes it useful.
      MAX_ATTEMPTS = "3"
    }
  }

  depends_on = [
    aws_iam_role_policy.consumer,
    aws_iam_role_policy_attachment.consumer_vpc,
    aws_cloudwatch_log_group.consumer,
  ]

  tags = { Name = "${var.prefix}-media-consumer" }
}

# -----------------------------------------------------------------------------
# EVENT SOURCE MAPPING
# -----------------------------------------------------------------------------

resource "aws_lambda_event_source_mapping" "media" {
  event_source_arn = aws_sqs_queue.media.arn
  function_name    = aws_lambda_function.media_consumer.arn

  # ONE MESSAGE PER INVOCATION. A batch shares a single function timeout, so
  # one slow file would take healthy ones down with it, and a partial failure
  # would re-run work that had already succeeded. Lambda scales out across
  # concurrent invocations instead, which is the throughput that actually
  # matters here.
  batch_size = 1

  # Without this, ANY reported failure redelivers the whole batch. At batch
  # size one the two behaviours coincide, but the handler already returns
  # batchItemFailures and the mapping has to opt in for that to mean anything —
  # if the batch size is ever raised, this is what stops it silently
  # reprocessing successful records.
  function_response_types = ["ReportBatchItemFailures"]
}

# -----------------------------------------------------------------------------
# THE ONE ALARM
#
# ADR 19 scopes the DLQ alarms in modules/monitoring to the queues that exist,
# which today is one. It is declared here rather than waiting for that module
# because a dead-lettered message is the signal that something is broken in a
# way nothing else reports: the row keeps its own attempt count, so a message
# that reaches the DLQ is one that could not even be written about.
#
# alarm_topic_arn is null until monitoring exists. The alarm still evaluates
# and still shows state; it just has nowhere to publish.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "media_dlq" {
  alarm_name        = "${var.prefix}-media-dlq-not-empty"
  alarm_description = "A media job failed every retry and could not record why. See the media consumer's logs."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"
  dimensions  = { QueueName = aws_sqs_queue.media_dlq.name }

  # SQS publishes this every five minutes, so one period is the fastest honest
  # evaluation. Maximum rather than Average: a single message is the event, and
  # averaging would dilute it towards zero across the period.
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"

  # A queue with no traffic reports no data rather than zero. Treating that as
  # breaching would alarm on every idle environment, which is most of them.
  treat_missing_data = "notBreaching"

  alarm_actions = var.alarm_topic_arn == null ? [] : [var.alarm_topic_arn]
  ok_actions    = var.alarm_topic_arn == null ? [] : [var.alarm_topic_arn]

  tags = { Name = "${var.prefix}-media-dlq-not-empty" }
}
