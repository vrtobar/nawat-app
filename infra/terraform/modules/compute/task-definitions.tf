# =============================================================================
# MODULE: COMPUTE — LOG GROUPS AND TASK DEFINITIONS
# =============================================================================

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.prefix}/api"
  retention_in_days = var.log_retention_days
  tags              = { Name = "${var.prefix}-api-logs" }
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.prefix}/web"
  retention_in_days = var.log_retention_days
  tags              = { Name = "${var.prefix}-web-logs" }
}

# Migration output is only ever read when a deploy fails, so it is kept
# briefly regardless of the environment's retention setting.
resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${var.prefix}/migrate"
  retention_in_days = 7
  tags              = { Name = "${var.prefix}-migrate-logs" }
}

# -----------------------------------------------------------------------------
# Shared database wiring
#
# The AWS-managed RDS secret contains ONLY username and password — verified
# against the live secret, contradicting PLAN §7's six-key assumption. Host,
# port, and database name are not sensitive and come from the data layer's
# Terraform outputs as plain environment variables.
#
# buildDatabaseUrl() in @nahuat/database assembles DATABASE_URL from exactly
# these five, URL-encoding the credentials because AWS-generated passwords can
# contain reserved characters.
# -----------------------------------------------------------------------------

locals {
  db_env = [
    { name = "DB_HOST", value = var.db_host },
    { name = "DB_PORT", value = tostring(var.db_port) },
    { name = "DB_NAME", value = var.db_name },
  ]

  db_secrets = [
    { name = "DB_USERNAME", valueFrom = "${var.db_secret_arn}:username::" },
    { name = "DB_PASSWORD", valueFrom = "${var.db_secret_arn}:password::" },
  ]

  # Shared by the API and the migration task, which run the same image.
  api_base_env = concat(local.db_env, [
    { name = "NODE_ENV", value = "production" },
    { name = "REDIS_HOST", value = var.redis_host },
    { name = "REDIS_PORT", value = tostring(var.redis_port) },
  ])

  # awslogs rather than a sidecar: Pino already writes structured JSON to
  # stdout, so the driver is the whole pipeline.
  log_config = {
    api     = { group = aws_cloudwatch_log_group.api.name, prefix = "api" }
    web     = { group = aws_cloudwatch_log_group.web.name, prefix = "web" }
    migrate = { group = aws_cloudwatch_log_group.migrate.name, prefix = "migrate" }
  }
}

# -----------------------------------------------------------------------------
# Ownership split
#
# Terraform owns the task definition SHAPE — environment, secrets, sizing,
# architecture, logging. CI owns the IMAGE. On each deploy the workflow
# describes the newest revision of the family, replaces only the image, and
# registers the result, so Terraform changes still reach production by way of
# the revision CI copies from.
#
# The consequence is that var.image_tag below is not what is running; see its
# declaration in variables.tf. The service pointer is ignored in ecs.tf for the
# same reason.
#
# The migration task is different and easy to get wrong: it has no service, so
# nothing ignores its revision, and CI must register its own copy and run THAT
# revision by ARN. Running the family name would execute whatever image
# Terraform last wrote — migrating with the previous release's code.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# API
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  # Must match the ECR image architecture. The images are built
  # --platform linux/arm64; a mismatch here produces tasks that fail to start
  # with an opaque exec format error.
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${var.ecr_api_url}:${var.image_tag}"
      essential = true

      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]

      environment = concat(local.api_base_env, [
        { name = "S3_BUCKET", value = var.assets_bucket_name },
        { name = "CDN_URL", value = var.cdn_domain },
        { name = "WEB_URL", value = "https://${var.environment == "production" ? "nahuat.com" : "${var.environment}.nahuat.com"}" },
        # Enables the real SQS producer instead of the synchronous local
        # fallback. Queue URLs arrive with the messaging module.
        { name = "SQS_ENABLED", value = "false" },
      ])

      secrets = concat(local.db_secrets, [
        { name = "AUTH0_DOMAIN", valueFrom = "${var.secret_arns["auth0"]}:domain::" },
        { name = "AUTH0_CLIENT_ID", valueFrom = "${var.secret_arns["auth0"]}:clientId::" },
        { name = "AUTH0_CLIENT_SECRET", valueFrom = "${var.secret_arns["auth0"]}:clientSecret::" },
        { name = "AUTH0_AUDIENCE", valueFrom = "${var.secret_arns["auth0"]}:audience::" },
        { name = "AUTH0_MGMT_CLIENT_ID", valueFrom = "${var.secret_arns["auth0_mgmt"]}:clientId::" },
        { name = "AUTH0_MGMT_CLIENT_SECRET", valueFrom = "${var.secret_arns["auth0_mgmt"]}:clientSecret::" },
        { name = "INTERNAL_SECRET", valueFrom = "${var.secret_arns["internal"]}:secret::" },
      ])

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = local.log_config.api.group
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = local.log_config.api.prefix
        }
      }

      stopTimeout = var.ecs_stop_timeout
    }
  ])

  tags = { Name = "${var.prefix}-api" }
}

# -----------------------------------------------------------------------------
# Web
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "web" {
  family                   = "${var.prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "${var.ecr_web_url}:${var.image_tag}"
      essential = true

      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        # Server-side rendering calls the API over the public hostname, which
        # resolves to this same ALB. Slightly indirect, but it means SSR and
        # browser requests exercise the identical path.
        { name = "API_URL", value = "https://${var.api_domain}" },
        { name = "NEXT_PUBLIC_API_URL", value = "https://${var.api_domain}" },
        { name = "APP_BASE_URL", value = "https://${var.environment == "production" ? "nahuat.com" : "${var.environment}.nahuat.com"}" },
      ]

      # v4 SDK variable names. AUTH0_SECRET encrypts the session cookie; it is
      # a separate key inside the auth0 secret rather than a reuse of
      # INTERNAL_SECRET, which guards the /auth/role endpoint. Sharing one
      # value across both would mean compromising either one compromises the
      # other, despite serving unrelated trust boundaries.
      secrets = [
        { name = "AUTH0_DOMAIN", valueFrom = "${var.secret_arns["auth0"]}:domain::" },
        { name = "AUTH0_CLIENT_ID", valueFrom = "${var.secret_arns["auth0"]}:clientId::" },
        { name = "AUTH0_CLIENT_SECRET", valueFrom = "${var.secret_arns["auth0"]}:clientSecret::" },
        { name = "AUTH0_SECRET", valueFrom = "${var.secret_arns["auth0"]}:sessionSecret::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = local.log_config.web.group
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = local.log_config.web.prefix
        }
      }

      stopTimeout = var.ecs_stop_timeout
    }
  ])

  tags = { Name = "${var.prefix}-web" }
}

# -----------------------------------------------------------------------------
# Migration
#
# Same image as the API, no port, no service — run as a one-off task by the
# deploy workflow before services roll. Running migrations at application
# startup instead would let several tasks race each other, and relying on
# Prisma's advisory lock to arbitrate that is fragile.
#
# The command is overridden at RunTask time for seeding, which is how staging
# gets its data.
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = "${var.ecr_api_url}:${var.image_tag}"
      essential = true

      command = ["npm", "run", "db:migrate", "--workspace=@nahuat/database"]

      environment = local.api_base_env
      secrets     = local.db_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = local.log_config.migrate.group
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = local.log_config.migrate.prefix
        }
      }
    }
  ])

  tags = { Name = "${var.prefix}-migrate" }
}
