# =============================================================================
# MODULE: MESSAGING — VARIABLES
# =============================================================================

variable "prefix" {
  description = "Resource name prefix, e.g. nahuat-production"
  type        = string
}

variable "consumer_timeout_seconds" {
  description = <<-EOT
    How long the media consumer may run on one message. The queue's visibility
    timeout is derived from this, so the two cannot be set inconsistently.

    300 seconds is generous for a file capped at 10MB: an audio normalise and
    transcode is seconds, and image derivatives are faster. It is sized for the
    pathological case rather than the normal one, because the cost of being
    wrong is a message redelivered while it is still being worked on.
  EOT
  type        = number
  default     = 300
}

# -----------------------------------------------------------------------------
# THE CONSUMER
# -----------------------------------------------------------------------------

variable "ecr_media_consumer_url" {
  description = "ECR repository URL for the media consumer image"
  type        = string
}

variable "image_tag" {
  description = "Image tag, the same one the task definitions get, so one commit deploys everywhere"
  type        = string

  # Same rule as modules/compute, for the same reason (docs/adr/0002): a
  # floating tag makes every version of a function indistinguishable, and
  # "what is running right now" stops having an answer.
  validation {
    condition     = can(regex("^(prod|staging)-[0-9a-f]{40}$", var.image_tag))
    error_message = "image_tag must be prod-<sha> or staging-<sha> with a full 40-character commit SHA."
  }
}

variable "private_subnet_ids" {
  description = "Private subnets. The consumer is VPC-attached because it writes to RDS."
  type        = list(string)
}

variable "lambda_sg_id" {
  description = "Lambda security group ID from foundation"
  type        = string
}

variable "assets_bucket_name" {
  description = "Assets bucket name, injected as ASSETS_BUCKET"
  type        = string
}

variable "assets_bucket_arn" {
  description = "Assets bucket ARN, for the per-prefix object grants"
  type        = string
}

variable "db_secret_arn" {
  description = "RDS master secret ARN. Read at cold start rather than injected, so the password is not in function configuration."
  type        = string
}

variable "db_host" {
  description = "Database endpoint"
  type        = string
}

variable "db_port" {
  description = "Database port"
  type        = number
}

variable "db_name" {
  description = "Database name"
  type        = string
}

variable "memory_mb" {
  description = <<-EOT
    Lambda memory, which also sets the CPU share — the two are not separable,
    so this is a CPU decision as much as a memory one. ffmpeg and Pillow are
    CPU-bound on files that are small enough to fit anywhere, so the number is
    chosen for how fast a transcode runs rather than for what it allocates.
  EOT
  type        = number
  default     = 2048
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Long enough to investigate a dead-lettered message, which is what the DLQ's own retention is sized for."
  type        = number
  default     = 14
}

variable "alarm_topic_arn" {
  description = <<-EOT
    Where the dead-letter alarm publishes. Null until modules/monitoring
    exists, which is deliberate rather than pending: the alarm is real and
    visible either way, and wiring it to a destination is that module's job.
    An alarm with no action still shows state; it just tells nobody.
  EOT
  type        = string
  default     = null
}

# -----------------------------------------------------------------------------
# THE REAPER
# -----------------------------------------------------------------------------

variable "reaper_schedule" {
  description = "How often the reaper sweeps. Chosen for how long an upload may stay stuck, not for cost — the run sits well inside the Lambda free tier."
  type        = string
  default     = "rate(15 minutes)"
}

variable "reaper_timeout_seconds" {
  description = "Two queries and a bounded batch of deletes. Generous; a run that hits this has found something pathological."
  type        = number
  default     = 120
}

variable "reaper_memory_mb" {
  description = "Nothing here decodes media. Memory also sets the CPU share, which is most of why the reaper costs a fraction of the consumer per second."
  type        = number
  default     = 512
}

variable "stale_pending_minutes" {
  description = "How long a PENDING row with no attempts may sit before its message is assumed lost and republished."
  type        = number
  default     = 15
}

variable "abandoned_upload_hours" {
  description = "How long an unconfirmed upload survives. Generous because deleting a recording is unrecoverable and waiting costs kilobytes."
  type        = number
  default     = 24
}
