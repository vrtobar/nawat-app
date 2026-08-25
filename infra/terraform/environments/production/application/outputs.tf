# =============================================================================
# PRODUCTION APPLICATION — OUTPUTS
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

output "rds_db_name" {
  description = "Initial database name on the instance; read by db-tunnel.sh so the DSN is not hand-typed"
  value       = module.database.db_name
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

output "api_task_family" {
  description = "API task definition family, described by the deploy workflow"
  value       = module.compute.api_task_family
}

output "web_task_family" {
  description = "Web task definition family, described by the deploy workflow"
  value       = module.compute.web_task_family
}

output "migrate_task_family" {
  description = "Migration task family, run before services roll"
  value       = module.compute.migrate_task_family
}

output "api_domain" {
  description = "Public API hostname"
  value       = module.compute.api_domain
}

# Network configuration for `aws ecs run-task`. The migration task uses awsvpc
# networking, so RunTask must be handed subnets and a security group; unlike a
# service, it has none attached to it. These originate in the foundation layer
# and are re-exported here so the deploy workflow reads one state file rather
# than two.
#
# The API security group specifically: the migration task must reach RDS, and
# the database's ingress rule matches on that group rather than on a CIDR.
output "ecs_subnet_ids" {
  description = "Private subnets for run-task network configuration"
  value       = data.terraform_remote_state.foundation.outputs.ecs_subnet_ids
}

output "ecs_api_sg_id" {
  description = "Security group for run-task; the same one the API service uses"
  value       = data.terraform_remote_state.foundation.outputs.ecs_api_sg_id
}

# -----------------------------------------------------------------------------
# Bastion — read by infra/scripts/db-tunnel.sh
#
# Null when enable_bastion is false, which the script reports as "no bastion in
# this environment" rather than failing on a missing output.
# -----------------------------------------------------------------------------
output "bastion_instance_id" {
  description = "SSM bastion instance id, or null when no bastion is enabled"
  value       = one(module.bastion[*].instance_id)
}
