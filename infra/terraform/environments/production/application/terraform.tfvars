# =============================================================================
# PRODUCTION APPLICATION — VALUES
# =============================================================================

environment = "production"
region      = "us-east-1"

# Networking
nat_gateway_count = 1 # 2 for HA (~$32/month more)

# Database — production settings: protected, snapshotted, week of backups
rds_instance_class    = "db.t3.micro"
rds_multi_az          = false
deletion_protection   = true
skip_final_snapshot   = false
backup_retention_days = 7

# Cache
cache_node_type = "cache.t3.micro"
