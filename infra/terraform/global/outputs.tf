# =============================================================================
# GLOBAL — OUTPUTS
# Consumed by the foundation layers via terraform_remote_state.
# =============================================================================

# -----------------------------------------------------------------------------
# Route53
# -----------------------------------------------------------------------------

output "route53_zone_id" {
  description = "Hosted zone ID — used by foundation layers to add DNS records"
  value       = aws_route53_zone.nahuat.zone_id
}

output "route53_name_servers" {
  description = <<-EOT
    Copy these 4 NS records to Namecheap custom nameservers.
    Only needed once after first apply. DNS propagation: up to 48 hours.
  EOT
  value       = aws_route53_zone.nahuat.name_servers
}

# -----------------------------------------------------------------------------
# ACM
# -----------------------------------------------------------------------------

output "acm_certificate_arn" {
  description = "Wildcard cert ARN — used by CloudFront distributions and ALB HTTPS listeners"
  value       = aws_acm_certificate_validation.wildcard.certificate_arn
}

# -----------------------------------------------------------------------------
# ECR
# -----------------------------------------------------------------------------

output "ecr_api_url" {
  description = "ECR repository URL for NestJS API — used in ECS task definitions and CI/CD"
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_web_url" {
  description = "ECR repository URL for Next.js web — used in ECS task definitions and CI/CD"
  value       = aws_ecr_repository.web.repository_url
}

output "ecr_registry" {
  description = "ECR registry URL (account + region) — used in GitHub Actions to authenticate"
  # repository_url is {account}.dkr.ecr.{region}.amazonaws.com/{name};
  # the registry is everything before the first slash
  value = split("/", aws_ecr_repository.api.repository_url)[0]
}

# -----------------------------------------------------------------------------
# IAM — CI/CD role ARNs
# Set as GitHub repository variables (not secrets — ARNs are not sensitive)
# under Settings → Secrets and variables → Actions → Variables.
# -----------------------------------------------------------------------------

output "github_production_role_arn" {
  description = "Add to GitHub variable: AWS_PRODUCTION_ROLE_ARN"
  value       = aws_iam_role.github_production.arn
}

output "github_staging_role_arn" {
  description = "Add to GitHub variable: AWS_STAGING_ROLE_ARN"
  value       = aws_iam_role.github_staging.arn
}
