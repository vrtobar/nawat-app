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
