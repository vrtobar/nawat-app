# =============================================================================
# GLOBAL — VARIABLES
# =============================================================================

variable "github_subject" {
  description = <<-EOT
    Prefix of the OIDC `sub` claim GitHub Actions presents to STS, used in the
    trust policy conditions that scope the CI/CD roles to this repository.

    NOT 'repo:owner/repo'. GitHub issues IMMUTABLE subject claims, embedding
    the numeric owner and repository IDs:

      repo:vrtobar@4165944/nahuat-platform@1330083450

    Verified against CloudTrail, not inferred. The plain 'repo:owner/repo'
    form is what most documentation still shows and it does not match — the
    symptom is 'Not authorized to perform sts:AssumeRoleWithWebIdentity' with
    nothing wrong on either side that inspection reveals.

    The IDs are the point: this survives renaming the user or the repository,
    which the name-based form did not, and it cannot be claimed by someone
    who registers a username you released.

    To re-derive:
      gh api repos/<owner>/<repo> --jq '.id'
      gh api users/<owner>       --jq '.id'
  EOT
  type        = string
  default     = "repo:vrtobar@4165944/nahuat-platform@1330083450"
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
