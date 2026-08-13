# =============================================================================
# STAGING FOUNDATION — PROVIDER VERSIONS
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
  region = var.region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "nahuat-platform"
      ManagedBy   = "terraform"
      Layer       = "foundation"
    }
  }
}
