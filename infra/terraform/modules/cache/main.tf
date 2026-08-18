# =============================================================================
# MODULE: CACHE — ElastiCache Valkey
#
# Valkey is the Redis-protocol-compatible fork AWS moved to after Redis
# relicensed; ioredis and @nestjs/throttler treat it as Redis, and it costs
# less per node than the equivalent Redis offering.
#
# Serves three things:
#   rate limit counters shared across ECS tasks (@nestjs/throttler)
#   dictionary entry cache   — entry:{entryId},       1 hour TTL
#   search result cache      — search:{md5(params)},  5 minute TTL
#
# A replication group rather than aws_elasticache_cluster, despite this being
# a single node: only the replication group resource supports
# at_rest_encryption_enabled. aws_elasticache_cluster offers transit
# encryption alone, which would leave the requirement half met.
# =============================================================================

resource "aws_elasticache_subnet_group" "main" {
  name        = "${var.prefix}-cache-subnet-group"
  description = "ElastiCache subnet group for ${var.prefix}"
  subnet_ids  = var.private_subnet_ids

  tags = { Name = "${var.prefix}-cache-subnet-group" }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.prefix}-cache"
  description          = "Valkey cache for ${var.prefix}"

  engine         = "valkey"
  engine_version = var.engine_version
  node_type      = var.node_type
  port           = 6379

  # Single node: one member, no replica to promote, so failover is impossible
  # by construction rather than merely disabled. The cache holds nothing that
  # cannot be recomputed from Postgres — a cold cache costs latency, not data.
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [var.redis_sg_id]

  # Derived from the engine version so a major upgrade does not silently keep
  # the previous family's parameter group.
  parameter_group_name = "default.valkey${split(".", var.engine_version)[0]}"

  at_rest_encryption_enabled = true

  # TRADEOFF: TLS in transit, but no AUTH token — access rests entirely on VPC
  # placement plus the redis security group. Adding a token means managing and
  # rotating another secret for a cache holding no user data. See BACKLOG.md.
  #
  # Clients MUST enable TLS to connect at all; ioredis needs an explicit
  # `tls: {}` option, and omitting it produces a connection timeout rather
  # than a clear protocol error.
  transit_encryption_enabled = true

  maintenance_window = "tue:05:00-tue:06:00" # UTC, after the RDS window

  # Nothing here is worth restoring; a rebuilt cache repopulates from Postgres.
  snapshot_retention_limit = 0

  # Patch releases only, applied during the maintenance window.
  auto_minor_version_upgrade = true

  # Otherwise upgrades and resizes wait for the maintenance window, which for
  # a cache with no durable state is needless delay.
  apply_immediately = true

  tags = { Name = "${var.prefix}-cache" }
}
