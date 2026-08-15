# =============================================================================
# MODULE: COMPUTE — VARIABLES
# =============================================================================

variable "prefix" {
  description = "Resource name prefix, e.g. nahuat-production"
  type        = string
}

variable "environment" {
  description = "Environment name; forms DNS records, log group paths, and secret paths"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# From foundation
# -----------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID; target groups must be created in it"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets for the ALB. Both AZs are required by ELB."
  type        = list(string)
}

variable "ecs_subnet_ids" {
  description = "Private subnets for task placement; already respects single_az_mode"
  type        = list(string)
}

variable "alb_sg_id" {
  description = "ALB security group ID"
  type        = string
}

variable "ecs_api_sg_id" {
  description = "ECS API security group ID"
  type        = string
}

variable "ecs_web_sg_id" {
  description = "ECS Web security group ID"
  type        = string
}

variable "acm_certificate_arn" {
  description = "Wildcard ACM cert ARN for the HTTPS listener"
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone ID for the ALB DNS records"
  type        = string
}

# CONSTRAINT on both hostnames below: each must be covered by the certificate
# this environment's foundation layer passes as acm_certificate_arn. TLS
# wildcards match exactly ONE label, so api.staging.nahuat.com needs
# *.staging.nahuat.com and is NOT covered by *.nahuat.com.
#
# Nothing catches a violation at apply time — an ALB accepts any certificate
# ARN without checking what it will serve, so a mismatch appears only as a TLS
# failure on the first request, including the web app's server-side fetches.
#
# Both are passed explicitly rather than derived from var.environment, because
# production omits the environment label (it owns the apex) while other
# environments include it. A conditional on the environment name would silently
# do the wrong thing for any third environment.
variable "api_domain" {
  description = "Public API hostname, e.g. api.nahuat.com or api.staging.nahuat.com. Must be covered by acm_certificate_arn."
  type        = string
}

variable "alb_domain" {
  description = <<-EOT
    Internal ALB hostname: alb.staging.nahuat.com, alb.nahuat.com. Same shape
    in both environments — production drops the environment label because it
    owns the apex, exactly as api_domain does.

    Each is one label under its environment's wildcard certificate, which is
    what the earlier hyphenated alb-production.nahuat.com was working around:
    alb.production.nahuat.com would have been two labels under *.nahuat.com.

    Must match the origin domain the foundation CloudFront distribution
    already points at — this record appearing and disappearing is what drives
    failover to the maintenance page.
  EOT
  type        = string
}

variable "ecr_api_url" {
  description = "ECR repository URL for the API image"
  type        = string
}

variable "ecr_web_url" {
  description = "ECR repository URL for the web image"
  type        = string
}

# Not the tag that is running: ignore_changes covers task_definition, so this
# is only a base for CI to copy and a floor for rebuilding from nothing.
variable "image_tag" {
  description = "Image tag Terraform writes into task definitions; CI overrides it per deploy"
  type        = string

  # Rejecting floating tags is what keeps ignore_changes = [task_definition]
  # safe in ecs.tf. See docs/adr/0002-immutable-image-tags.md
  validation {
    condition     = can(regex("^(prod|staging)-[0-9a-f]{40}$", var.image_tag))
    error_message = "image_tag must be prod-<sha> or staging-<sha> with a full 40-character commit SHA. Mutable tags such as 'latest' are rejected: they make every revision indistinguishable, so the deployment circuit breaker rolls back onto the same failing image."
  }
}

variable "assets_bucket_name" {
  description = "Assets bucket name, injected as S3_BUCKET"
  type        = string
}

variable "assets_bucket_arn" {
  description = "Assets bucket ARN, for the API task role's S3 policy"
  type        = string
}

variable "cdn_domain" {
  description = "CDN base URL, injected as CDN_URL"
  type        = string
}

variable "secret_arns" {
  description = "Foundation's Secrets Manager ARNs, keyed auth0 / auth0_mgmt / internal"
  type        = map(string)
}

# -----------------------------------------------------------------------------
# From the data layer
# -----------------------------------------------------------------------------

variable "db_secret_arn" {
  description = <<-EOT
    ARN of the AWS-managed RDS credentials secret.

    NOTE: it holds only `username` and `password`. PLAN §7 assumed six keys
    including host/port/dbname; verified against the live secret, they are not
    there. Host, port, and database name are passed as plain environment
    variables from the values below instead.
  EOT
  type        = string
}

variable "db_host" {
  description = "RDS endpoint hostname, injected as DB_HOST (not sensitive)"
  type        = string
}

variable "db_port" {
  description = "RDS port, injected as DB_PORT"
  type        = number
}

variable "db_name" {
  description = "Database name, injected as DB_NAME"
  type        = string
}

variable "redis_host" {
  description = "Cache endpoint, injected as REDIS_HOST"
  type        = string
}

variable "redis_port" {
  description = "Cache port, injected as REDIS_PORT"
  type        = number
}

# -----------------------------------------------------------------------------
# Task sizing
# -----------------------------------------------------------------------------

variable "api_cpu" {
  description = "API task CPU units. 256 = 0.25 vCPU."
  type        = number
  default     = 256
}

variable "api_memory" {
  description = "API task memory in MiB. Raise if OOM kills appear in CloudWatch."
  type        = number
  default     = 512
}

variable "web_cpu" {
  description = "Web task CPU units"
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Web task memory in MiB"
  type        = number
  default     = 512
}

# -----------------------------------------------------------------------------
# Health checks and deployment
#
# Production values are conservative; staging trades safety for speed because
# it is rebuilt constantly. See the environment tfvars for the split.
# -----------------------------------------------------------------------------

variable "health_check_interval" {
  description = "Seconds between target health checks"
  type        = number
  default     = 30
}

variable "health_check_timeout" {
  description = "Seconds before a health check attempt is considered failed"
  type        = number
  default     = 5
}

variable "healthy_threshold" {
  description = "Consecutive successes before a target is marked healthy"
  type        = number
  default     = 2
}

variable "unhealthy_threshold" {
  description = "Consecutive failures before a target is marked unhealthy"
  type        = number
  default     = 3
}

variable "health_check_grace_period" {
  description = "Seconds ECS ignores health checks after a task starts. Must exceed cold-start time or tasks are killed while still booting."
  type        = number
  default     = 60
}

variable "deregistration_delay" {
  description = "Seconds the ALB waits for in-flight requests before removing a target"
  type        = number
  default     = 300
}

variable "deployment_min_healthy_pct" {
  description = "Minimum percent of desired count kept running during a deploy. 50 keeps one task serving with desired_count 1; 0 allows full replacement."
  type        = number
  default     = 50
}

variable "ecs_stop_timeout" {
  description = "Seconds between SIGTERM and SIGKILL on task shutdown"
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Logs are the main ongoing CloudWatch cost."
  type        = number
  default     = 30
}

# -----------------------------------------------------------------------------
# Scaling
# -----------------------------------------------------------------------------

variable "desired_count" {
  description = "Tasks per service"
  type        = number
  default     = 1
}

variable "enable_autoscaling" {
  description = "Scale on CPU: out above 70% for 3 min, in below 30% for 10 min, between min and max below"
  type        = bool
  default     = false
}

variable "autoscaling_min" {
  description = "Minimum tasks when autoscaling is enabled"
  type        = number
  default     = 1
}

variable "autoscaling_max" {
  description = "Maximum tasks when autoscaling is enabled"
  type        = number
  default     = 3
}
