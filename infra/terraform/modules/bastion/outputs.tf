# =============================================================================
# MODULE: SSM BASTION — OUTPUTS
# =============================================================================

output "instance_id" {
  description = "Instance id; the target of aws ssm start-session"
  value       = aws_instance.bastion.id
}

output "private_ip" {
  description = "Private address, for confirming which host a session landed on"
  value       = aws_instance.bastion.private_ip
}

output "role_arn" {
  description = "Instance role ARN, for auditing what the bastion itself can do"
  value       = aws_iam_role.bastion.arn
}
