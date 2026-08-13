# =============================================================================
# MODULE: DATABASE — OUTPUTS
# =============================================================================

output "endpoint" {
  description = "Endpoint hostname. Stable across destroy and recreate because the identifier is fixed."
  value       = aws_db_instance.main.address
}

output "port" {
  description = "Database port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "master_username" {
  description = "Master username"
  value       = aws_db_instance.main.username
}

output "master_user_secret_arn" {
  description = <<-EOT
    ARN of the AWS-managed secret holding the RDS credentials, as
    { username, password, host, port, dbname, engine }.

    ECS task definitions pull the individual fields from it with JSON key
    extraction, e.g. valueFrom = "<arn>:password::". Lambda receives the ARN
    itself and resolves it at runtime.
  EOT
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "instance_id" {
  description = "Instance identifier, used as the CloudWatch alarm dimension"
  value       = aws_db_instance.main.identifier
}

output "instance_arn" {
  description = "Instance ARN"
  value       = aws_db_instance.main.arn
}
