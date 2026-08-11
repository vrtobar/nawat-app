# =============================================================================
# GLOBAL — REMOTE STATE BACKEND
# The bucket is created by infra/scripts/bootstrap.sh, before Terraform runs.
#
# use_lockfile is S3-native locking (Terraform >= 1.10), which replaces the
# deprecated dynamodb_table parameter — there is no lock table.
# =============================================================================
terraform {
  backend "s3" {
    bucket       = "nahuat-terraform-state"
    key          = "global/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
