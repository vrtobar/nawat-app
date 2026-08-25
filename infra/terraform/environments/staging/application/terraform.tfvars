# =============================================================================
# STAGING APPLICATION — VALUES
#
# This layer is spun up on demand and destroyed again, so every setting that
# guards against data loss in production is deliberately relaxed here: a
# destroy must not prompt, block, or leave snapshots behind.
# =============================================================================

environment = "staging"
region      = "us-east-1"

nat_gateway_count = 1

rds_instance_class    = "db.t4g.micro" # Graviton: ~11% cheaper than t3
rds_multi_az          = false
deletion_protection   = false # must not block terraform destroy
skip_final_snapshot   = true  # no snapshot accumulation from repeated teardowns
backup_retention_days = 1

cache_node_type = "cache.t4g.micro" # Graviton: ~6% cheaper than t3

# Database is empty and unused; flip to false before real traffic.
apply_immediately = true

# Compute — staging: faster feedback over safety, since it is rebuilt often.
# Shorter checks detect failure sooner, 0% minimum healthy allows a full
# replacement rather than waiting for drain, and logs age out in a week.
api_cpu                    = 256
api_memory                 = 512
web_cpu                    = 256
web_memory                 = 512
health_check_interval      = 10
health_check_timeout       = 3
unhealthy_threshold        = 2
health_check_grace_period  = 30
deregistration_delay       = 30
deployment_min_healthy_pct = 0
ecs_stop_timeout           = 5
log_retention_days         = 7
enable_autoscaling         = false

# Database access. True here because reaching staging's database is routine
# work and there is no other path to it: RDS is private and ECS Exec is off.
# Dies with `staging-deploy.yml down`, so it bills only while staging is up.
enable_bastion = true
