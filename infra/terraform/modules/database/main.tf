# =============================================================================
# MODULE: DATABASE — RDS PostgreSQL
# =============================================================================

# RDS requires subnets in two AZs even for a single-AZ instance. Which AZ the
# instance actually lands in is decided by multi_az, not by this group.
resource "aws_db_subnet_group" "main" {
  name        = "${var.prefix}-db-subnet-group"
  description = "RDS subnet group for ${var.prefix}"
  subnet_ids  = var.private_subnet_ids

  tags = { Name = "${var.prefix}-db-subnet-group" }
}

# A custom parameter group exists so settings can change without replacing the
# instance. family must track the engine major version.
#
# pg_trgm needs no entry here: it is a pure SQL extension enabled by CREATE
# EXTENSION in the first migration, not something requiring
# shared_preload_libraries.
resource "aws_db_parameter_group" "main" {
  name        = "${var.prefix}-pg${var.engine_version}"
  family      = "postgres${var.engine_version}"
  description = "PostgreSQL ${var.engine_version} parameters for ${var.prefix}"

  # Surfaces slow queries in CloudWatch Logs. Prisma generates the SQL here,
  # so this is the main way a bad query plan becomes visible.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # ms
  }

  # Lambda opens a connection per cold start; connection logging is how
  # connection exhaustion gets diagnosed before RDS Proxy is worth adding.
  parameter {
    name  = "log_connections"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# -----------------------------------------------------------------------------
# Instance
#
# identifier is fixed rather than generated: the endpoint hostname derives from
# it plus an account/region-specific suffix, so destroying and recreating
# returns the same hostname. That is what lets the application layer be torn
# down without rewriting any connection configuration.
#
# manage_master_user_password hands password generation and storage to AWS.
# The password never enters Terraform state, and the resulting secret carries
# host/port/dbname/username/password together — which is why the ECS task
# definition can pull all five from one place.
# -----------------------------------------------------------------------------
resource "aws_db_instance" "main" {
  identifier = "nahuat-${var.environment}"

  engine = "postgres"
  # Major version only, so AWS selects the current minor release.
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = var.db_name
  username = var.master_username

  manage_master_user_password = true

  # gp3 is cheaper and faster than gp2 at this size; 20GB is the floor AWS
  # allows. max_allocated_storage enables autoscaling up to that ceiling.
  storage_type          = "gp3"
  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_sg_id]
  publicly_accessible    = false

  parameter_group_name = aws_db_parameter_group.main.name

  multi_az = var.multi_az

  backup_retention_period = var.backup_retention_days
  backup_window           = "03:00-04:00"         # UTC, low traffic for El Salvador
  maintenance_window      = "Mon:04:00-Mon:05:00" # immediately after the backup window

  # Minor versions only. Major upgrades stay manual.
  auto_minor_version_upgrade = true

  # Verified supported on db.t3.micro for Postgres 16; 7 days retention is
  # within the free tier.
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  enabled_cloudwatch_logs_exports = ["postgresql"]

  # Snapshots inherit the provider default_tags, so they show up under the
  # Project cost allocation tag rather than as unattributed spend.
  copy_tags_to_snapshot = true

  deletion_protection = var.deletion_protection
  skip_final_snapshot = var.skip_final_snapshot

  # Only used when skip_final_snapshot is false. Snapshots outlive the
  # instance, so a fixed name would collide on the second destroy of a
  # recreated database; the timestamp is evaluated once at creation.
  final_snapshot_identifier = "nahuat-${var.environment}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  # timestamp() is impure and would otherwise show a diff on every plan.
  lifecycle {
    ignore_changes = [final_snapshot_identifier]
  }

  tags = { Name = "${var.prefix}-rds" }
}
