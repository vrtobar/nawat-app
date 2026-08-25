# =============================================================================
# PRODUCTION FOUNDATION — OUTPUTS
# Consumed by the application layer via terraform_remote_state.
# =============================================================================

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "vpc_cidr" {
  description = "VPC CIDR block"
  value       = module.networking.vpc_cidr
}

output "public_subnet_ids" {
  description = "Public subnet IDs for ALB registration (both AZs required)"
  value       = module.networking.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet IDs for RDS and ElastiCache subnet groups"
  value       = module.networking.private_subnet_ids
}

output "private_route_table_ids" {
  description = "Private route table IDs; the application layer's NAT module writes the default route into these"
  value       = module.networking.private_route_table_ids
}

output "ecs_subnet_ids" {
  description = "ECS task placement subnets; respects single_az_mode"
  value       = module.networking.ecs_subnet_ids
}

output "single_az_mode" {
  description = "Whether single AZ mode is enabled; passed through to the database module"
  value       = module.networking.single_az_mode
}

# -----------------------------------------------------------------------------
# Security groups
# -----------------------------------------------------------------------------

output "alb_sg_id" {
  description = "ALB security group ID"
  value       = module.security.alb_sg_id
}

output "ecs_api_sg_id" {
  description = "ECS API security group ID"
  value       = module.security.ecs_api_sg_id
}

output "ecs_web_sg_id" {
  description = "ECS Web security group ID"
  value       = module.security.ecs_web_sg_id
}

output "rds_sg_id" {
  description = "RDS security group ID"
  value       = module.security.rds_sg_id
}

output "redis_sg_id" {
  description = "ElastiCache security group ID"
  value       = module.security.redis_sg_id
}

output "lambda_sg_id" {
  description = "Lambda security group ID"
  value       = module.security.lambda_sg_id
}

output "bastion_sg_id" {
  description = "SSM bastion security group, attached to the bastion instance when one exists"
  value       = module.security.bastion_sg_id
}

# -----------------------------------------------------------------------------
# S3 and CloudFront
# -----------------------------------------------------------------------------

output "assets_bucket_name" {
  description = "Assets bucket name, for ECS env vars and upload presigning"
  value       = aws_s3_bucket.assets.bucket
}

output "assets_bucket_arn" {
  description = "Assets bucket ARN, for the API task role's S3 policy"
  value       = aws_s3_bucket.assets.arn
}

output "cdn_domain" {
  description = "CDN base URL, injected as CDN_URL"
  value       = "https://cdn.nahuat.com"
}

output "cdn_distribution_id" {
  description = "CDN distribution ID, used by cdn-invalidation-consumer"
  value       = aws_cloudfront_distribution.cdn.id
}

output "web_distribution_id" {
  description = "Web distribution ID"
  value       = aws_cloudfront_distribution.web.id
}

# -----------------------------------------------------------------------------
# Global passthrough
# Re-exported so the application layer reads one remote state instead of two.
# -----------------------------------------------------------------------------

output "acm_certificate_arn" {
  description = "Wildcard ACM cert ARN, for the ALB HTTPS listener"
  value       = data.terraform_remote_state.global.outputs.acm_certificate_arn
}

output "route53_zone_id" {
  description = "Hosted zone ID, for the application layer's ALB DNS records"
  value       = data.terraform_remote_state.global.outputs.route53_zone_id
}

output "ecr_api_url" {
  description = "ECR repository URL for the API image"
  value       = data.terraform_remote_state.global.outputs.ecr_api_url
}

output "ecr_web_url" {
  description = "ECR repository URL for the web image"
  value       = data.terraform_remote_state.global.outputs.ecr_web_url
}

# -----------------------------------------------------------------------------
# Secrets Manager
# ARNs only. Values are set by hand and never pass through Terraform.
# -----------------------------------------------------------------------------

output "secret_arns" {
  description = "Secret ARNs, referenced by ECS task definitions and IAM policies"
  value = {
    auth0      = aws_secretsmanager_secret.auth0.arn
    auth0_mgmt = aws_secretsmanager_secret.auth0_mgmt.arn
    internal   = aws_secretsmanager_secret.internal.arn
  }
}
