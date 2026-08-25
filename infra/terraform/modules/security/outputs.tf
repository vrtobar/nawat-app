# =============================================================================
# MODULE: SECURITY GROUPS — OUTPUTS
#
# Consumed by the database, cache, compute, and messaging modules in the
# application layer. These IDs are stable: the groups live in foundation and
# survive application layer teardown.
# =============================================================================

output "alb_sg_id" {
  description = "ALB security group; also the source for both ECS ingress rules"
  value       = aws_security_group.alb.id
}

output "ecs_api_sg_id" {
  description = "ECS API security group, attached to the NestJS service"
  value       = aws_security_group.ecs_api.id
}

output "ecs_web_sg_id" {
  description = "ECS Web security group, attached to the Next.js service"
  value       = aws_security_group.ecs_web.id
}

output "rds_sg_id" {
  description = "RDS security group, attached to the database instance"
  value       = aws_security_group.rds.id
}

output "redis_sg_id" {
  description = "Redis security group, attached to the ElastiCache cluster"
  value       = aws_security_group.redis.id
}

output "lambda_sg_id" {
  description = "Lambda security group, attached to every consumer's VPC config"
  value       = aws_security_group.lambda.id
}

output "bastion_sg_id" {
  description = "SSM bastion security group; RDS allows it on 5432. Created in both environments whether or not a bastion instance exists."
  value       = aws_security_group.bastion.id
}
