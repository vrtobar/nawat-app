# =============================================================================
# MODULE: CACHE — OUTPUTS
# =============================================================================

# Not sensitive: reaching it still requires being inside the VPC and in the
# redis security group, so this is passed to ECS as a plain environment
# variable rather than through Secrets Manager.
output "redis_host" {
  description = "Primary endpoint hostname, injected as REDIS_HOST"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "redis_port" {
  description = "Port, injected as REDIS_PORT"
  value       = aws_elasticache_replication_group.main.port
}

output "replication_group_id" {
  description = "Replication group ID, used as the CloudWatch alarm dimension"
  value       = aws_elasticache_replication_group.main.replication_group_id
}
