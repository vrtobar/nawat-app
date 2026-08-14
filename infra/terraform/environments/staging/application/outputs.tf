# =============================================================================
# STAGING APPLICATION — OUTPUTS
#
# Read by GitHub Actions at deploy time rather than hardcoded in workflows, so
# the pipeline cannot drift from the infrastructure.
# =============================================================================

output "nat_public_ips" {
  description = "Addresses the VPC egresses from; give these to anything that allow-lists by source IP"
  value       = module.nat.public_ips
}

output "rds_endpoint" {
  description = "Database endpoint hostname; stable across destroy and recreate"
  value       = module.database.endpoint
}

output "rds_port" {
  description = "Database port"
  value       = module.database.port
}

output "rds_instance_id" {
  description = "Database identifier, used as the CloudWatch alarm dimension"
  value       = module.database.instance_id
}

output "db_secret_arn" {
  description = <<-EOT
    ARN of the AWS-managed RDS credentials secret. ECS task definitions
    extract individual JSON keys from it; Lambda resolves it at runtime.
  EOT
  value       = module.database.master_user_secret_arn
}

output "redis_host" {
  description = "Cache endpoint, injected as REDIS_HOST. Clients must enable TLS."
  value       = module.cache.redis_host
}

output "redis_port" {
  description = "Cache port, injected as REDIS_PORT"
  value       = module.cache.redis_port
}

# TODO(compute): alb_dns_name, ecs_cluster_name, ecs service names — the
# deploy workflow needs these to force new deployments and run the migration
# task.

# -----------------------------------------------------------------------------
# Compute — read by the deploy workflow
# -----------------------------------------------------------------------------

output "alb_dns_name" {
  description = "ALB hostname, for reaching the app directly while diagnosing CloudFront"
  value       = module.compute.alb_dns_name
}

output "ecs_cluster_name" {
  description = "Cluster name for update-service and run-task"
  value       = module.compute.ecs_cluster_name
}

output "api_service_name" {
  description = "API service name"
  value       = module.compute.api_service_name
}

output "web_service_name" {
  description = "Web service name"
  value       = module.compute.web_service_name
}

output "migrate_task_family" {
  description = "Migration task family, run before services roll"
  value       = module.compute.migrate_task_family
}

output "api_domain" {
  description = "Public API hostname"
  value       = module.compute.api_domain
}
