# =============================================================================
# MODULE: SSM BASTION — VARIABLES
# =============================================================================

variable "prefix" {
  description = "Resource name prefix, e.g. nahuat-staging"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets from the foundation layer; the instance takes the first"
  type        = list(string)
}

variable "bastion_sg_id" {
  description = <<-EOT
    Bastion security group, created in the FOUNDATION layer. It lives there
    because the RDS group's ingress rules are inline and authoritative, so a
    cross-layer rule would be reverted on the next foundation apply.
  EOT
  type        = string
}

variable "instance_type" {
  description = "Instance type. t4g.nano is the smallest Graviton size (ADR 6) and is ample: this host forwards a TCP port and runs nothing else."
  type        = string
  default     = "t4g.nano"
}
