# =============================================================================
# PRODUCTION FOUNDATION — REMOTE STATE BACKEND
# S3-native locking (use_lockfile); no DynamoDB table is involved.
# =============================================================================
terraform {
  backend "s3" {
    bucket       = "nahuat-terraform-state"
    key          = "production/foundation/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
