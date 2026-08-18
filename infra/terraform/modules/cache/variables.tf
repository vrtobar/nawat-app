# =============================================================================
# MODULE: CACHE — VARIABLES
# =============================================================================

variable "prefix" {
  description = "Resource name prefix, e.g. nahuat-production"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the cache subnet group"
  type        = list(string)
}

variable "redis_sg_id" {
  description = "Redis security group ID from foundation"
  type        = string
}

variable "node_type" {
  description = "Cache node type. cache.t4g.micro (Graviton) is ~$9.34/month; t3 equivalent is ~$9.93."
  type        = string
  default     = "cache.t4g.micro"
}

variable "engine_version" {
  description = <<-EOT
    Valkey engine version. The original design specified 7.2; 8.1 is the
    default here because Valkey 8 brought substantial throughput gains and 7.2
    is now two majors behind. AWS also offers 9.x. The parameter group family
    is derived from the major version, so changing this picks up the matching
    family.
  EOT
  type        = string
  default     = "8.1"
}
