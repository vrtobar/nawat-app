# =============================================================================
# PRODUCTION APPLICATION
#
# The disposable layer. Everything here can be destroyed and rebuilt against
# foundation's stable VPC, security group, and CloudFront IDs — which is why
# the NAT gateway lives here rather than in foundation, and why the RDS
# identifier is fixed so the endpoint hostname survives a recreate.
#
# Destroying this layer takes down alb.{env}.nahuat.com with it, CloudFront
# starts returning 502, and the maintenance page takes over. That path is
# already proven: it is what nahuat.com serves right now.
#
# Currently: NAT, database, cache. Compute, messaging, and monitoring arrive
# on their own branches.
# =============================================================================

locals {
  prefix = "nahuat-${var.environment}"
}

# One remote state read, not two: foundation re-exports what it needs from
# global (cert ARN, zone ID, ECR URLs).
data "terraform_remote_state" "foundation" {
  backend = "s3"
  config = {
    bucket = "nahuat-terraform-state"
    key    = "production/foundation/terraform.tfstate"
    region = "us-east-1"
  }
}

# =============================================================================
# NAT
#
# Placed here rather than in foundation so the ~$32/month cost disappears with
# the layer. Foundation owns the private route tables; this writes the default
# route into them.
# =============================================================================

module "nat" {
  source = "../../../modules/nat"

  prefix                  = local.prefix
  nat_gateway_count       = var.nat_gateway_count
  public_subnet_ids       = data.terraform_remote_state.foundation.outputs.public_subnet_ids
  private_route_table_ids = data.terraform_remote_state.foundation.outputs.private_route_table_ids
}

# =============================================================================
# DATABASE
# =============================================================================

module "database" {
  source = "../../../modules/database"

  prefix      = local.prefix
  environment = var.environment

  private_subnet_ids = data.terraform_remote_state.foundation.outputs.private_subnet_ids
  rds_sg_id          = data.terraform_remote_state.foundation.outputs.rds_sg_id

  instance_class        = var.rds_instance_class
  multi_az              = var.rds_multi_az
  deletion_protection   = var.deletion_protection
  skip_final_snapshot   = var.skip_final_snapshot
  backup_retention_days = var.backup_retention_days
  apply_immediately     = var.apply_immediately
}

# =============================================================================
# CACHE
# =============================================================================

module "cache" {
  source = "../../../modules/cache"

  prefix             = local.prefix
  private_subnet_ids = data.terraform_remote_state.foundation.outputs.private_subnet_ids
  redis_sg_id        = data.terraform_remote_state.foundation.outputs.redis_sg_id

  node_type = var.cache_node_type
}

# TODO(feat/terraform-application-compute):    module "compute"
# TODO(feat/terraform-application-messaging):  module "messaging"
# TODO(feat/terraform-application-monitoring): module "monitoring"
