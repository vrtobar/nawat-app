# =============================================================================
# PRODUCTION APPLICATION — VALUES
# =============================================================================

environment = "production"
region      = "us-east-1"

# Networking
nat_gateway_count = 1 # 2 for HA (~$32/month more)

# Database — DISPOSABLE during pre-launch (ADR 17). Deletion protection off and
# no final snapshot, so the application layer can be torn down between sessions
# without a manual unlock and without accumulating a snapshot per teardown.
# Both revert to the protected/snapshotted values at launch, when the database
# stops being disposable. See docs/production-lifecycle.md.
rds_instance_class    = "db.t4g.micro" # Graviton: ~11% cheaper than t3
rds_multi_az          = false
deletion_protection   = false # true at launch
skip_final_snapshot   = true  # false at launch
backup_retention_days = 7

# Cache
cache_node_type = "cache.t4g.micro" # Graviton: ~6% cheaper than t3

# False now that production serves real logins. A modification applied
# immediately can reboot the instance the moment the apply runs; deferring to
# the maintenance window trades convergence speed for not choosing an arbitrary
# minute to drop connections.
#
# The cost is the confusing part described in the module's variable: an apply
# succeeds while the change sits in PendingModifiedValues, and every plan until
# the window shows the same diff. That is the correct trade once anyone is
# using the database.
#
# Staging stays true — it is rebuilt constantly and has no users to disturb.
apply_immediately = false

# image_tag IS DELIBERATELY NOT SET HERE, matching staging. Pass it at apply
# time: `terraform apply -var image_tag=prod-<sha>`.
#
# NOT the image that is running. The deploy workflow registers its own task
# definition revision per release and the services ignore Terraform's, so the
# value only takes effect when the environment is rebuilt from nothing.
#
# It was previously pinned here as a disaster-recovery floor — the release a
# from-scratch apply would come up on — and the idea is sound. What it could
# not survive is going stale silently, which it did three ways at once: the
# commit it named was orphaned by the 2026-08-18 history rewrite, its images
# aged out of both ECR repositories, and a third repository
# (nahuat-media-consumer) was added that had never held a prod- tag at all.
# None of that surfaced until an apply was attempted, because nothing reads
# this value until then.
#
# A pinned value is only a floor while every repository still holds it, and
# nothing in this configuration can check that. An unset variable fails the
# plan immediately and names itself; a stale one fails minutes into an apply,
# at Lambda image validation, having already created RDS. So the floor now
# lives with whoever runs the apply, who must pick a tag and confirm it is
# present in all three repositories first:
#
#   for r in nahuat-api nahuat-web nahuat-media-consumer; do
#     aws ecr describe-images --repository-name "$r" \
#       --image-ids imageTag="$TAG" --query 'imageDetails[].imagePushedAt' \
#       --output text
#   done

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

# Database access. Same as staging, and deliberately so.
#
# Gating this off was considered and rejected. It would protect against accident
# rather than against an attacker: anyone who can apply this layer can set the
# variable themselves or launch a host by hand, so the gate stops a mistake, not
# a credential. What it would cost is the only practical way to read or correct
# production data — the alternative, a command override on the migrate task,
# runs in a node:24-alpine image with no psql, cannot return rows through
# `prisma db execute`, and needs a CloudWatch round trip per invocation.
#
# Access is therefore an IAM question, which is where it belongs:
# ssm:StartSession on the instance, plus GetSecretValue on the RDS secret. The
# security group has no ingress rules at all, so there is nothing reachable
# without them.
#
# The instance still dies with this layer, so a torn-down production has no
# bastion either.
enable_bastion = true
