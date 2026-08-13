# =============================================================================
# MODULE: NAT — VARIABLES
# =============================================================================

variable "prefix" {
  description = "Resource name prefix, e.g. nahuat-production"
  type        = string
}

variable "nat_gateway_count" {
  description = <<-EOT
    1 = single gateway in AZ-a (~$32/month); an AZ-a outage severs private
    egress for the whole VPC and AZ-b pays cross-AZ transfer.
    2 = one per AZ for true HA at double the cost.
  EOT
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 2], var.nat_gateway_count)
    error_message = "nat_gateway_count must be 1 or 2."
  }
}

variable "public_subnet_ids" {
  description = "Public subnet IDs from foundation; gateways are placed here in order"
  type        = list(string)
}

variable "private_route_table_ids" {
  description = "Private route table IDs from foundation, which receive the default route"
  type        = list(string)
}
