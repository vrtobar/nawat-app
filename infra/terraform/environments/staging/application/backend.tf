# =============================================================================
# STAGING APPLICATION — REMOTE STATE BACKEND
# =============================================================================
terraform {
  backend "s3" {
    bucket       = "nahuat-terraform-state"
    key          = "staging/application/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
