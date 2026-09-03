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

  # Production drops the environment from the hostname; other
  # environments include it.
  api_domain = "api.nahuat.com"

  # Production omits the environment label here for the same reason api_domain
  # does — it owns the apex. That also resolves what the hyphen was working
  # around: alb.production.nahuat.com is two labels and *.nahuat.com matches
  # exactly one, so the name was bent to alb-production.nahuat.com rather than
  # the convention being questioned. alb.nahuat.com is one label and covered.
  #
  # MUST match the origin domain in foundation's CloudFront distribution.
  # Changing one without the other points CloudFront at a hostname that does
  # not exist, which fails over to the maintenance page.
  alb_domain = "alb.nahuat.com"
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

# =============================================================================
# MESSAGING
# =============================================================================

module "messaging" {
  source = "../../../modules/messaging"

  prefix = local.prefix

  # The consumer. Same image_tag as the task definitions, so one commit
  # deploys everywhere rather than leaving the Lambda a version behind.
  ecr_media_consumer_url = data.terraform_remote_state.foundation.outputs.ecr_media_consumer_url
  image_tag              = var.image_tag

  # VPC-attached for RDS. S3 goes over the gateway endpoint.
  private_subnet_ids = data.terraform_remote_state.foundation.outputs.private_subnet_ids
  lambda_sg_id       = data.terraform_remote_state.foundation.outputs.lambda_sg_id

  assets_bucket_name = data.terraform_remote_state.foundation.outputs.assets_bucket_name
  assets_bucket_arn  = data.terraform_remote_state.foundation.outputs.assets_bucket_arn

  db_secret_arn = module.database.master_user_secret_arn
  db_host       = module.database.endpoint
  db_port       = module.database.port
  db_name       = module.database.db_name
}

# TODO(feat/terraform-application-monitoring): module "monitoring"

# =============================================================================
# COMPUTE
# =============================================================================

module "compute" {
  source = "../../../modules/compute"

  prefix      = local.prefix
  environment = var.environment
  region      = var.region

  # Foundation
  vpc_id              = data.terraform_remote_state.foundation.outputs.vpc_id
  public_subnet_ids   = data.terraform_remote_state.foundation.outputs.public_subnet_ids
  ecs_subnet_ids      = data.terraform_remote_state.foundation.outputs.ecs_subnet_ids
  alb_sg_id           = data.terraform_remote_state.foundation.outputs.alb_sg_id
  ecs_api_sg_id       = data.terraform_remote_state.foundation.outputs.ecs_api_sg_id
  ecs_web_sg_id       = data.terraform_remote_state.foundation.outputs.ecs_web_sg_id
  acm_certificate_arn = data.terraform_remote_state.foundation.outputs.acm_certificate_arn
  route53_zone_id     = data.terraform_remote_state.foundation.outputs.route53_zone_id
  ecr_api_url         = data.terraform_remote_state.foundation.outputs.ecr_api_url
  ecr_web_url         = data.terraform_remote_state.foundation.outputs.ecr_web_url
  assets_bucket_name  = data.terraform_remote_state.foundation.outputs.assets_bucket_name
  assets_bucket_arn   = data.terraform_remote_state.foundation.outputs.assets_bucket_arn
  cdn_domain          = data.terraform_remote_state.foundation.outputs.cdn_domain
  secret_arns         = data.terraform_remote_state.foundation.outputs.secret_arns

  # Hostnames. Production's API is api.nahuat.com while staging's is
  # api.staging.nahuat.com, so these are set per environment rather than
  # derived; alb_domain must match what foundation's CloudFront already
  # points at.
  api_domain = local.api_domain
  alb_domain = local.alb_domain

  # Messaging. The API is the media queue's only producer (ADR 19's
  # amendment), so this is what turns SQS_ENABLED on for the task.
  media_queue_url = module.messaging.media_queue_url

  # Data layer
  db_secret_arn = module.database.master_user_secret_arn
  db_host       = module.database.endpoint
  db_port       = module.database.port
  db_name       = module.database.db_name
  redis_host    = module.cache.redis_host
  redis_port    = module.cache.redis_port

  image_tag = var.image_tag

  # Sizing and rollout
  api_cpu                    = var.api_cpu
  api_memory                 = var.api_memory
  web_cpu                    = var.web_cpu
  web_memory                 = var.web_memory
  health_check_interval      = var.health_check_interval
  health_check_timeout       = var.health_check_timeout
  unhealthy_threshold        = var.unhealthy_threshold
  health_check_grace_period  = var.health_check_grace_period
  deregistration_delay       = var.deregistration_delay
  deployment_min_healthy_pct = var.deployment_min_healthy_pct
  ecs_stop_timeout           = var.ecs_stop_timeout
  log_retention_days         = var.log_retention_days
  enable_autoscaling         = var.enable_autoscaling
}

# =============================================================================
# BASTION
#
# Gated, and off by default. See modules/bastion for why it is safe to define
# and what it deliberately cannot do.
#
# In the APPLICATION layer so it dies with a teardown and bills only while the
# environment is up — roughly $3/month if one were left running, and staging is
# not. Its security group is in foundation; only the instance is here.
# =============================================================================

# APPLY ORDER: foundation before this layer, and foundation is applied by a
# human — staging-deploy.yml only ever touches application (its TF_DIR is
# pinned to it). So a `staging-deploy.yml up` run against a foundation that
# predates the bastion security group fails here, on a bastion_sg_id output
# that does not exist yet, and takes the whole bring-up with it.
module "bastion" {
  count  = var.enable_bastion ? 1 : 0
  source = "../../../modules/bastion"

  prefix             = local.prefix
  private_subnet_ids = data.terraform_remote_state.foundation.outputs.private_subnet_ids
  bastion_sg_id      = data.terraform_remote_state.foundation.outputs.bastion_sg_id
}
