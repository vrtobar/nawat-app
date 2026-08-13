# =============================================================================
# PRODUCTION APPLICATION — VARIABLES
# =============================================================================

variable "environment" {
  description = "Environment name; forms resource names, secret paths, and the RDS identifier"
  type        = string
  default     = "production"
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
  description = "RDS instance class. db.t3.micro is ~$15/month."
  type        = string
  default     = "db.t3.micro"
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
  description = "ElastiCache node type. cache.t3.micro is ~$12/month."
  type        = string
  default     = "cache.t3.micro"
}
