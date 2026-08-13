# =============================================================================
# MODULE: NETWORKING — OUTPUTS
# =============================================================================

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "VPC CIDR block, for security group rules that match on range"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet IDs for ALB registration (both AZs required)"
  value       = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

output "private_subnet_ids" {
  description = "All private subnet IDs, for RDS and ElastiCache subnet groups"
  value       = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

output "primary_private_subnet_id" {
  description = "Private subnet in AZ-a"
  value       = aws_subnet.private_a.id
}

# The application layer's NAT module writes the default route into these.
# Index 0 serves AZ-a, index 1 serves AZ-b.
output "private_route_table_ids" {
  description = "Private route table IDs, for the application layer's NAT default route"
  value       = aws_route_table.private[*].id
}

# Resolving single_az_mode here rather than in the compute module keeps the
# placement decision with the subnets it concerns.
output "ecs_subnet_ids" {
  description = "Subnets for ECS task placement; respects single_az_mode"
  value = var.single_az_mode ? [
    aws_subnet.private_a.id
    ] : [
    aws_subnet.private_a.id,
    aws_subnet.private_b.id
  ]
}

output "single_az_mode" {
  description = "Whether single AZ mode is enabled; passed through to the database module"
  value       = var.single_az_mode
}
