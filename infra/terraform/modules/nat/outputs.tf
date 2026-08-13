# =============================================================================
# MODULE: NAT — OUTPUTS
# =============================================================================

output "nat_gateway_ids" {
  description = "NAT gateway IDs"
  value       = aws_nat_gateway.main[*].id
}

output "public_ips" {
  description = <<-EOT
    Elastic IPs the VPC egresses from. These are the addresses to give any
    third party that allow-lists by source IP.
  EOT
  value       = aws_eip.nat[*].public_ip
}
