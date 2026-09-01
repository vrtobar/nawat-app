# =============================================================================
# MODULE: MESSAGING — OUTPUTS
# =============================================================================

# Injected into the API task definition as SQS_MEDIA_QUEUE_URL. Not sensitive:
# a queue URL is not a credential, and publishing to it still requires the
# task role's sqs:SendMessage.
output "media_queue_url" {
  description = "Media queue URL, injected as SQS_MEDIA_QUEUE_URL"
  value       = aws_sqs_queue.media.url
}

output "media_queue_arn" {
  description = "Media queue ARN, for the consumer's event source mapping"
  value       = aws_sqs_queue.media.arn
}

output "media_dlq_arn" {
  description = "Dead-letter queue ARN"
  value       = aws_sqs_queue.media_dlq.arn
}

# The alarm dimension is the queue NAME, not its ARN or URL.
output "media_dlq_name" {
  description = "Dead-letter queue name, used as the CloudWatch alarm dimension"
  value       = aws_sqs_queue.media_dlq.name
}
