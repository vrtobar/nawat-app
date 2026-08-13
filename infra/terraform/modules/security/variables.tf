# =============================================================================
# MODULE: SECURITY GROUPS — VARIABLES
# =============================================================================

variable "prefix" {
  description = "Resource name prefix, e.g. nahuat-production"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID from the networking module"
  type        = string
}
