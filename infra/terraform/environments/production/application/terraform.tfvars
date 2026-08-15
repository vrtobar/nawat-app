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

# NOT the image that is running. The deploy workflow registers its own task
# definition revision per release and the services ignore Terraform's, so this
# value only takes effect when the environment is rebuilt from nothing. Treat
# it as the disaster-recovery floor: the release a from-scratch apply would
# come up on. Bump it when that floor should move, not on every deploy.
#
# First real prod- tag, built by the production workflow from main at 809c161
# and verified present in both ECR repositories. Replaces the all-zero
# placeholder, which satisfied the format validation but named no image a
# from-scratch rebuild could pull.
image_tag = "prod-809c1618c1438495db43a09e7dbffeffa464e0df"

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
