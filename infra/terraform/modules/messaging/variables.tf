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
