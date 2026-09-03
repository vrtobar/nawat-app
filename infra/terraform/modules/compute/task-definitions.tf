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
# against the live secret, contradicting the original design's assumption that
# it carried six keys. Host, port, and database name are not sensitive and come
# from the data layer's Terraform outputs as plain environment variables.
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
# Ownership split: Terraform owns the task definition SHAPE (environment,
# secrets, sizing, architecture, logging); CI owns the IMAGE, by copying the
# newest revision and substituting the tag. So var.image_tag below is not what
# is running. Rationale: docs/adr/0002-immutable-image-tags.md
#
# The migration task is the exception and is easy to get wrong: it has no
# service, so nothing ignores its revision, and CI must register its own copy
# and run THAT revision by ARN. Running the family name would migrate the
# database with the previous release's code.
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
        # The media queue, and the API's own publishing to it (ADR 19's
        # amendment). There was never a "synchronous local fallback" as the
        # previous comment here claimed — with SQS off, an upload simply stops
        # at PENDING, which is honest locally because nothing would process it
        # anyway. Deployed, both are set: env validation rejects a boot where
        # SQS_ENABLED is true and the URL is missing.
        { name = "SQS_ENABLED", value = "true" },
        { name = "SQS_MEDIA_QUEUE_URL", value = var.media_queue_url },
        # `iss` and `aud` on every access token this API mints, and the values
        # it demands when verifying one. Derived from this environment's own API
        # hostname rather than shared, so a token minted for staging is
        # structurally invalid against production even before its signature is
        # checked (docs/adr/0018).
        { name = "JWT_ISSUER", value = "https://${var.api_domain}" },
        { name = "JWT_AUDIENCE", value = "https://${var.api_domain}" },
      ])

      secrets = concat(local.db_secrets, [
        # No JSON key suffix: this secret holds the base64 key set as a plain
        # string, exactly as `auth:keygen` prints it.
        { name = "JWT_SIGNING_KEYS", valueFrom = var.secret_arns["jwt_signing"] },
        # The audience every Google ID token must carry. The API takes the
        # client ID alone — the SECRET belongs to the web container below, which
        # performs the code exchange — so a compromise here yields no credential
        # able to obtain a Google identity.
        { name = "GOOGLE_CLIENT_ID", valueFrom = "${var.secret_arns["google"]}:clientId::" },
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
        # ⚠️ AUTH_URL IS NOT OPTIONAL BEHIND A LOAD BALANCER, and its absence
        # fails in two ways at once — both seen on staging 2026-08-28.
        #
        # Auth.js derives `trustHost` from, among other things,
        # `NODE_ENV !== "production"`. Locally that is true and the host is
        # trusted; in this container NODE_ENV IS production, so without one of
        # AUTH_URL / AUTH_TRUST_HOST / VERCEL / CF_PAGES it refuses the request
        # as an untrusted host and the sign-in dies as `error=Configuration`.
        # The condition that triggers it is the very thing that distinguishes a
        # deployed environment, so no local run can reproduce it.
        #
        # It also pins the ORIGIN. Auth.js rewrites the request origin to this
        # value; without it the origin is inferred from the request, which
        # behind the ALB is the container's own address — a sign-in redirected
        # to https://ip-10-1-4-33.ec2.internal:3000. That is the second time
        # this project has sent a user to an internal hostname; the first was
        # the Auth0-era session-failed route, fixed the same way.
        #
        # Preferred over AUTH_TRUST_HOST because it does both jobs and depends
        # on no header: trusting the Host header would work only while nothing
        # can reach the container except through the ALB.
        { name = "AUTH_URL", value = "https://${var.environment == "production" ? "nahuat.com" : "${var.environment}.nahuat.com"}" },
      ]

      # BOTH HALVES OF THE GOOGLE CLIENT LIVE HERE and nowhere else. This tier
      # performs the authorization code exchange, which is what needs the
      # secret; the API container above verifies an assertion Google already
      # signed and takes the client ID alone.
      #
      # AUTH_SECRET is a separate Secrets Manager secret rather than another key
      # in the Google one. They rotate for unrelated reasons and answer to
      # different trust boundaries, and sharing an ARN makes that separation
      # nominal — anything able to read one key reads every key in the secret.
      secrets = [
        { name = "GOOGLE_CLIENT_ID", valueFrom = "${var.secret_arns["google"]}:clientId::" },
        { name = "GOOGLE_CLIENT_SECRET", valueFrom = "${var.secret_arns["google"]}:clientSecret::" },
        { name = "AUTH_SECRET", valueFrom = var.secret_arns["web_session"] },
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
