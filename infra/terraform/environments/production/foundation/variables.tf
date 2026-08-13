# =============================================================================
# PRODUCTION FOUNDATION — VARIABLES
# =============================================================================

variable "environment" {
  description = "Environment name, used in resource naming, tagging, and secret paths"
  type        = string
  default     = "production"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "single_az_mode" {
  description = <<-EOT
    Place ECS tasks in AZ-a only. Subnets are still created in both AZs because
    ALB and subnet groups require it.
  EOT
  type        = bool
  default     = false
}

variable "enable_vpc_endpoints" {
  description = <<-EOT
    Interface endpoints for Secrets Manager and CloudWatch Logs (~$14/month).
    Keeps that traffic off the NAT gateway.
  EOT
  type        = bool
  default     = false
}
