# =============================================================================
# STAGING APPLICATION — VARIABLES
# =============================================================================

variable "environment" {
  description = "Environment name; forms resource names, secret paths, and the RDS identifier"
  type        = string
  default     = "staging"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

variable "nat_gateway_count" {
  description = "1 = single gateway (~$32/month), AZ-a only. 2 = one per AZ for HA at double the cost."
  type        = number
  default     = 1
}

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------

variable "rds_instance_class" {
  description = "RDS instance class. db.t4g.micro (Graviton) is ~$11.68/month; t3 equivalent is ~$13.14."
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_multi_az" {
  description = "Standby in a second AZ with automatic failover; roughly doubles RDS cost"
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Blocks terraform destroy on the database until disabled"
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip the snapshot taken on destroy"
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Automated backup retention in days"
  type        = number
  default     = 7
}

# -----------------------------------------------------------------------------
# Cache
# -----------------------------------------------------------------------------

variable "cache_node_type" {
  description = "ElastiCache node type. cache.t4g.micro (Graviton) is ~$9.34/month; t3 equivalent is ~$9.93."
  type        = string
  default     = "cache.t4g.micro"
}

variable "apply_immediately" {
  description = "Apply RDS modifications at once rather than deferring to the maintenance window"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Compute
# -----------------------------------------------------------------------------

# No default, and not set in terraform.tfvars: staging is created and destroyed
# by its workflow, which passes the tag it just built. A missing value should
# fail the plan rather than resolve to something stale.
variable "image_tag" {
  description = "Image tag to deploy, passed by the staging workflow as staging-{sha}"
  type        = string
}

variable "api_cpu" {
  description = "API task CPU units; 256 = 0.25 vCPU"
  type        = number
  default     = 256
}

variable "api_memory" {
  description = "API task memory in MiB"
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

variable "health_check_interval" {
  description = "Seconds between target health checks"
  type        = number
  default     = 30
}

variable "health_check_timeout" {
  description = "Seconds before a health check attempt fails"
  type        = number
  default     = 5
}

variable "unhealthy_threshold" {
  description = "Consecutive failures before a target is unhealthy"
  type        = number
  default     = 3
}

variable "health_check_grace_period" {
  description = "Seconds ECS ignores health checks after task start"
  type        = number
  default     = 60
}

variable "deregistration_delay" {
  description = "Seconds the ALB drains a target before removing it"
  type        = number
  default     = 300
}

variable "deployment_min_healthy_pct" {
  description = "Minimum percent of desired count kept running during a deploy"
  type        = number
  default     = 50
}

variable "ecs_stop_timeout" {
  description = "Seconds between SIGTERM and SIGKILL on shutdown"
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "enable_autoscaling" {
  description = "Scale services on CPU between the module's min and max"
  type        = bool
  default     = false
}

variable "enable_bastion" {
  description = <<-EOT
    Whether to create the SSM bastion. True in both environments: it is the only
    practical way to read or correct data in a database that is private by
    design, and gating it would guard against accident rather than against an
    attacker, since anyone able to apply this layer can set it themselves.

    Kept as a variable rather than hardcoded so an environment can go without
    one. The instance is the part that costs money, and it disappears with a
    teardown either way.
  EOT
  type        = bool
  default     = false
}
