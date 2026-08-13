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
