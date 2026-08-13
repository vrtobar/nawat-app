# =============================================================================
# MODULE: DATABASE — VARIABLES
# =============================================================================

variable "prefix" {
  description = "Resource name prefix, e.g. nahuat-production"
  type        = string
}

variable "environment" {
  description = "Environment name. Forms the RDS identifier, which is what keeps the endpoint hostname stable across destroy and recreate."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the DB subnet group; RDS requires two AZs"
  type        = list(string)
}

variable "rds_sg_id" {
  description = "RDS security group ID from foundation"
  type        = string
}

# -----------------------------------------------------------------------------
# Sizing
# -----------------------------------------------------------------------------

variable "instance_class" {
  description = "RDS instance class. db.t4g.micro (Graviton) is ~$11.68/month; t3 equivalent is ~$13.14."
  type        = string
  default     = "db.t4g.micro"
}

variable "engine_version" {
  description = "PostgreSQL major version. Major only, so AWS picks the current minor; also forms the parameter group family."
  type        = string
  default     = "16"
}

variable "db_name" {
  description = "Initial database name created on the instance"
  type        = string
  default     = "nahuat"
}

variable "master_username" {
  description = "Master username. The password is generated and stored by AWS, never by Terraform."
  type        = string
  default     = "nahuat"
}

variable "allocated_storage" {
  description = "Initial storage in GB. 20 is the gp3 minimum."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling in GB. 0 disables autoscaling."
  type        = number
  default     = 100
}

# -----------------------------------------------------------------------------
# Resilience and safety
# -----------------------------------------------------------------------------

variable "multi_az" {
  description = <<-EOT
    Standby in a second AZ with automatic failover. Roughly doubles the cost
    (~$15 to ~$30/month). See BACKLOG.md before enabling.
  EOT
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Blocks destroy until disabled. True for production, false for staging, which is torn down routinely."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip the snapshot taken on destroy. False for production (a recovery point), true for staging."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Automated backup retention in days. 0 disables backups entirely."
  type        = number
  default     = 7
}

variable "apply_immediately" {
  description = <<-EOT
    Apply modifications at once instead of deferring to the maintenance window.

    AWS defaults this to false, which is safe for a database with users but
    surprising in Terraform: an apply "succeeds" while the change sits in
    PendingModifiedValues, and every subsequent plan shows the same diff until
    the window passes. True is correct while the database is empty; set it
    false before real traffic, when a reboot at an arbitrary moment matters
    more than immediate convergence.
  EOT
  type        = bool
  default     = false
}
