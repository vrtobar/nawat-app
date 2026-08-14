# =============================================================================
# MODULE: COMPUTE — OUTPUTS
# Consumed by the deploy workflow, which reads them at run time rather than
# hardcoding names that would drift.
# =============================================================================

output "alb_dns_name" {
  description = "ALB hostname. Useful for hitting the app directly, bypassing CloudFront, while diagnosing CDN behaviour."
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID, for alias records"
  value       = aws_lb.main.zone_id
}

output "alb_arn_suffix" {
  description = "ALB ARN suffix, used as the CloudWatch dimension for request and latency metrics"
  value       = aws_lb.main.arn_suffix
}

output "ecs_cluster_name" {
  description = "Cluster name, for aws ecs update-service and run-task"
  value       = aws_ecs_cluster.main.name
}

output "api_service_name" {
  description = "API service name, for --force-new-deployment"
  value       = aws_ecs_service.api.name
}

output "web_service_name" {
  description = "Web service name, for --force-new-deployment"
  value       = aws_ecs_service.web.name
}

output "migrate_task_definition_arn" {
  description = "Migration task definition, run one-off before services roll"
  value       = aws_ecs_task_definition.migrate.arn
}

output "migrate_task_family" {
  description = "Migration task family. Prefer this over the ARN in workflows so the latest revision is used."
  value       = aws_ecs_task_definition.migrate.family
}

output "api_target_group_arn_suffix" {
  description = "API target group suffix, for CloudWatch healthy-host metrics"
  value       = aws_lb_target_group.api.arn_suffix
}

output "web_target_group_arn_suffix" {
  description = "Web target group suffix, for CloudWatch healthy-host metrics"
  value       = aws_lb_target_group.web.arn_suffix
}

output "api_domain" {
  description = "Public API hostname"
  value       = var.api_domain
}
