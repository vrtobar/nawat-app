# =============================================================================
# GLOBAL — VARIABLES
# =============================================================================

variable "github_repo" {
  description = <<-EOT
    GitHub repository in 'owner/repo' form, used in the OIDC trust policy
    conditions that scope the CI/CD roles to this repo.
    WARNING: renaming or transferring the repo invalidates those conditions.
    Update this value and re-apply, or GitHub Actions loses the ability to
    assume the AWS roles.
  EOT
  type        = string
  default     = "vrtobar/nahuat-platform"
}

variable "dmarc_report_email" {
  description = <<-EOT
    Address receiving DMARC aggregate reports.
    Must be at nahuat.com: sending reports to an address on another domain
    requires that domain to publish an authorization record
    (nahuat.com._report._dmarc.<their-domain>), which is not possible for a
    provider like Gmail. Reports will bounce until inbound SES is configured.
  EOT
  type        = string
  default     = "dmarc@nahuat.com"
}
