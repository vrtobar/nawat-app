# =============================================================================
# MODULE: COMPUTE — IAM
#
# Two kinds of role, and the distinction matters:
#
#   Execution role — assumed by the ECS agent, not your code. Used before the
#                    container starts, to pull the image and resolve secrets
#                    into environment variables. Shared by all three task
#                    definitions.
#   Task role      — assumed by the running container. This is what the
#                    application's AWS SDK calls use. Separate per service, so
#                    the web app cannot reach the API's S3 bucket or queues.
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# -----------------------------------------------------------------------------
# Execution role
# -----------------------------------------------------------------------------

resource "aws_iam_role" "execution" {
  name               = "${var.prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
  description        = "Assumed by the ECS agent to pull images, write logs, and resolve secrets"
}

# ECR pull and CloudWatch Logs. The AWS-managed policy covers both and tracks
# API changes; the secret access below is what actually needs scoping.
resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Resolving `secrets` entries in a task definition happens under the execution
# role, before the container exists — so this is what must be able to read
# them, not the task role.
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid    = "ReadTaskSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = concat(
      values(var.secret_arns),
      [var.db_secret_arn],
    )
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.prefix}-ecs-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# -----------------------------------------------------------------------------
# API task role
# -----------------------------------------------------------------------------

resource "aws_iam_role" "api_task" {
  name               = "${var.prefix}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
  description        = "Assumed by the NestJS container for its own AWS calls"
}

data "aws_iam_policy_document" "api_task" {
  # Presigned upload URLs. Objects are written directly by the browser, so the
  # API only ever signs — it never proxies the bytes.
  statement {
    sid    = "AssetObjects"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["${var.assets_bucket_arn}/*"]
  }

  # Queue ARNs are matched by prefix rather than listed: the queues live in the
  # messaging module, which is applied separately, and this role must exist
  # before them. The prefix keeps it scoped to this environment.
  statement {
    sid    = "PublishToQueues"
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
    ]
    resources = [
      "arn:aws:sqs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:${var.prefix}-*",
    ]
  }

  # X-Ray has no resource-level permissions; these actions are only ever "*".
  statement {
    sid    = "Tracing"
    effect = "Allow"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
    ]
    resources = ["*"]
  }

  # Custom business metrics (LessonsCompleted, DictionarySearches, NewUsers,
  # SRSReviews). PutMetricData cannot be scoped by resource, but it can be
  # confined to one namespace, which stops a bug from polluting AWS/* metrics.
  statement {
    sid       = "BusinessMetrics"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["Nahuat/Application"]
    }
  }
}

resource "aws_iam_role_policy" "api_task" {
  name   = "${var.prefix}-api-task"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task.json
}

# -----------------------------------------------------------------------------
# Web task role
#
# Deliberately thin. Next.js reads its Auth0 secrets through the execution
# role at startup, so the running container needs nothing beyond tracing.
# -----------------------------------------------------------------------------

resource "aws_iam_role" "web_task" {
  name               = "${var.prefix}-web-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
  description        = "Assumed by the Next.js container"
}

data "aws_iam_policy_document" "web_task" {
  statement {
    sid    = "Tracing"
    effect = "Allow"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "web_task" {
  name   = "${var.prefix}-web-task"
  role   = aws_iam_role.web_task.id
  policy = data.aws_iam_policy_document.web_task.json
}
