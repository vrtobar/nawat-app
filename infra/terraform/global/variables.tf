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
