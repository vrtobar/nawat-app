# =============================================================================
# PRODUCTION FOUNDATION — VALUES
# Cost-optimized. See BACKLOG.md for what each toggle buys.
# =============================================================================

environment          = "production"
region               = "us-east-1"
single_az_mode       = false
enable_vpc_endpoints = false # true keeps Secrets Manager/Logs off NAT (~$14/month)
