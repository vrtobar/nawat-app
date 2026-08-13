# =============================================================================
# MODULE: NETWORKING — VARIABLES
# =============================================================================

variable "prefix" {
  description = "Resource name prefix, e.g. nahuat-production"
  type        = string
}

variable "region" {
  description = "AWS region. Subnet AZs are derived from it as <region>a and <region>b."
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Addressing
# Each /24 gives 251 usable addresses (256 less the 5 AWS reserves).
# Third octet: 1/2 public, 3/4 private.
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_a_cidr" {
  description = "Public subnet AZ-a (ALB)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "public_subnet_b_cidr" {
  description = "Public subnet AZ-b (ALB)"
  type        = string
  default     = "10.0.2.0/24"
}

variable "private_subnet_a_cidr" {
  description = "Private subnet AZ-a (ECS, RDS, Redis, Lambda)"
  type        = string
  default     = "10.0.3.0/24"
}

variable "private_subnet_b_cidr" {
  description = "Private subnet AZ-b (subnet groups require two AZs)"
  type        = string
  default     = "10.0.4.0/24"
}

# -----------------------------------------------------------------------------
# Cost and resilience toggles
# -----------------------------------------------------------------------------

variable "single_az_mode" {
  description = <<-EOT
    Place ECS tasks in AZ-a only. Subnets are still created in both AZs
    because ALB and subnet groups require it — only compute placement changes,
    via the ecs_subnet_ids output.
  EOT
  type        = bool
  default     = false
}

# nat_gateway_count lives on modules/nat in the application layer now — see
# the note in main.tf for why the gateway moved out of this module.

variable "enable_vpc_endpoints" {
  description = <<-EOT
    Interface endpoints for Secrets Manager and CloudWatch Logs (~$14/month
    total). Keeps that traffic off the NAT gateway; not cost-effective until
    NAT data processing exceeds the endpoints' hourly charge.
  EOT
  type        = bool
  default     = false
}
