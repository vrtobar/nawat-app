# =============================================================================
# GLOBAL — PROVIDER VERSIONS
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  # Tags every resource in this layer without per-resource repetition
  default_tags {
    tags = {
      Project   = "nahuat-platform"
      ManagedBy = "terraform"
      Layer     = "global"
    }
  }
}
