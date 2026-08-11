#!/bin/bash
# =============================================================================
# NAHUAT PLATFORM — BOOTSTRAP SCRIPT
# Run this ONCE before any Terraform commands.
# Prerequisites: AWS CLI configured with admin credentials.
# =============================================================================

set -euo pipefail

AWS_REGION="us-east-1"
STATE_BUCKET="nahuat-terraform-state"

echo "=== Nahuat Platform Bootstrap ==="
echo "Region: $AWS_REGION"
echo "State bucket: $STATE_BUCKET"
echo ""

# -----------------------------------------------------------------------------
# S3 — Terraform state bucket
# -----------------------------------------------------------------------------
echo "Creating Terraform state S3 bucket..."

aws s3 mb s3://$STATE_BUCKET --region $AWS_REGION 2>/dev/null || \
  echo "Bucket already exists, skipping creation"

# Enable versioning — allows recovery of previous state files
aws s3api put-bucket-versioning \
  --bucket $STATE_BUCKET \
  --versioning-configuration Status=Enabled

# Enable encryption at rest
aws s3api put-bucket-encryption \
  --bucket $STATE_BUCKET \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Block all public access — state files must never be public
aws s3api put-public-access-block \
  --bucket $STATE_BUCKET \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo "✅ State bucket created: $STATE_BUCKET"

# NOTE: no DynamoDB lock table — state locking is S3-native
# (use_lockfile = true in every backend block, Terraform ≥1.10).

# -----------------------------------------------------------------------------
# GitHub Actions OIDC provider
# Allows GitHub Actions to assume IAM roles without long-lived credentials.
# The thumbprint is GitHub's OIDC certificate thumbprint — stable value.
# -----------------------------------------------------------------------------
echo "Creating GitHub Actions OIDC provider..."

aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 2>/dev/null || \
  echo "OIDC provider already exists, skipping creation"

echo "✅ GitHub Actions OIDC provider created"

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Next steps:"
echo "  1. cd infra/terraform/global"
echo "  2. terraform init"
echo "  3. terraform apply"
echo "  4. Copy the 4 NS records from output to Namecheap custom nameservers"
echo "  5. Wait for DNS propagation (up to 48 hours)"
echo "  6. cd ../environments/production/foundation && terraform init && terraform apply"
