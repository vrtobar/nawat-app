# =============================================================================
# PRODUCTION APPLICATION — VALUES
# =============================================================================

environment = "production"
region      = "us-east-1"

# Networking
nat_gateway_count = 1 # 2 for HA (~$32/month more)

# Database — production settings: protected, snapshotted, week of backups
rds_instance_class    = "db.t4g.micro" # Graviton: ~11% cheaper than t3
rds_multi_az          = false
deletion_protection   = true
skip_final_snapshot   = false
backup_retention_days = 7

# Cache
cache_node_type = "cache.t4g.micro" # Graviton: ~6% cheaper than t3

# Database is empty and unused; flip to false before real traffic.
apply_immediately = true

# Compute — production: conservative rollout, one task serving throughout
api_cpu                    = 256
api_memory                 = 512
web_cpu                    = 256
web_memory                 = 512
health_check_interval      = 30
health_check_timeout       = 5
unhealthy_threshold        = 3
health_check_grace_period  = 60
deregistration_delay       = 300
deployment_min_healthy_pct = 50
ecs_stop_timeout           = 30
log_retention_days         = 30
enable_autoscaling         = false
