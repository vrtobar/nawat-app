# =============================================================================
# GLOBAL — ACCOUNT-WIDE RESOURCES
# Created once, never destroyed. Shared by every environment.
#
# Run order: bootstrap.sh → terraform apply → copy NS records to Namecheap
# =============================================================================

# Scopes IAM resource ARNs below to this account rather than a wildcard
data "aws_caller_identity" "current" {}

# -----------------------------------------------------------------------------
# Route53 — Hosted zone
#
# One zone for all environments — staging and production add their own
# records to it rather than owning separate zones.
#
# NEVER destroy: a replacement zone gets new NS records, requiring another
# manual Namecheap update and up to 48h of propagation.
# -----------------------------------------------------------------------------
resource "aws_route53_zone" "nahuat" {
  name    = "nahuat.com"
  comment = "Nahuat platform — managed by Terraform"
}

# -----------------------------------------------------------------------------
# ACM — Wildcard SSL certificate
#
# Lives in global because one cert covers every environment, it auto-renews
# once issued, and CloudFront requires its certs in us-east-1.
#
# The first apply will block on validation until the Namecheap NS cutover
# propagates — ACM cannot resolve the validation records before then.
# -----------------------------------------------------------------------------
resource "aws_acm_certificate" "wildcard" {
  domain_name               = "nahuat.com"
  subject_alternative_names = ["*.nahuat.com"]
  validation_method         = "DNS"

  # Avoids a certificate-less window if the cert is ever replaced
  lifecycle {
    create_before_destroy = true
  }
}

# The apex and wildcard domains produce the same validation CNAME; keying
# the map by domain plus allow_overwrite lets both entries resolve to it
# without a duplicate-record error.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.nahuat.zone_id
}

# Consumers read the cert ARN from this resource, not from the certificate
# itself — depending on it is what prevents downstream layers from
# attaching an unvalidated cert.
resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn = aws_acm_certificate.wildcard.arn

  validation_record_fqdns = [
    for record in aws_route53_record.cert_validation : record.fqdn
  ]
}

# -----------------------------------------------------------------------------
# ECR — Container image repositories
#
# One repo per image, shared across environments, with the environment encoded
# in the tag prefix: prod-{sha} and staging-{sha}. The lifecycle rules below
# key off those prefixes.
#
# Note that this is not build-once-promote. Staging builds from develop and
# production builds from main, and squash merges mean the two never share a
# commit SHA, so there is no common artifact to retag. Production rebuilds
# from main's tree. Only one role may write here; see github_build below.
# -----------------------------------------------------------------------------

# IMMUTABLE is load-bearing, not hygiene: task definitions name a tag rather
# than a digest, so a mutable tag would let the bytes behind an already-deployed
# release change with no deployment to show for it. Reverting this to MUTABLE
# also invalidates ignore_changes = [task_definition] in modules/compute.
# Rationale: docs/adr/0002-immutable-image-tags.md
resource "aws_ecr_repository" "api" {
  name                 = "nahuat-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true # no cost
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "nahuat-web"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# The media consumer. A Lambda rather than an ECS service, and an image rather
# than a zip, because an ffmpeg binary does not fit the zip packaging model —
# which is what turns ADR 11's container decision from convenient into
# required.
#
# The same immutable tags apply, and for a reason this repository already
# relies on: everything running in production, ECS task or Lambda, is named by
# a prod-{sha} tag identifying the commit that built it. Under zip, Lambda
# would be identified by a bundle hash instead, and "what is running right
# now" would have two different answers depending on which compute was asked.
resource "aws_ecr_repository" "media_consumer" {
  name                 = "nahuat-media-consumer"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Shared by all three repos — caps storage cost (~$0.10/GB/month)
locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        # Deep enough for a rollback to any recent release
        rulePriority = 1
        description  = "Keep last 10 production images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["prod-"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
      {
        # Staging is transient — fewer rollback targets needed
        rulePriority = 2
        description  = "Keep last 5 staging images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["staging-"]
          countType     = "imageCountMoreThan"
          countNumber   = 5
        }
        action = { type = "expire" }
      },
      {
        # Orphaned build layers, which accumulate on every push
        rulePriority = 3
        description  = "Remove untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      }
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy     = local.ecr_lifecycle_policy
}

# ⚠️ RULE 3 IS LOAD-BEARING FOR LAMBDA, not just tidiness. Expiring untagged
# images would delete the children of a buildx image index out from under a
# live function about a day after deploy, with no code change to blame. The
# push must therefore set provenance and sbom false, exactly as the ECS image
# builds already do.
resource "aws_ecr_lifecycle_policy" "media_consumer" {
  repository = aws_ecr_repository.media_consumer.name
  policy     = local.ecr_lifecycle_policy
}

# -----------------------------------------------------------------------------
# IAM — GitHub Actions OIDC roles
#
# OIDC federation means no AWS access keys are stored in GitHub — nothing
# to leak or rotate.
#
# The provider itself is created by bootstrap.sh, so it is read here rather
# than managed.
# -----------------------------------------------------------------------------
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# -----------------------------------------------------------------------------
# Production trust policy
#
# Scoped to the GitHub 'production' environment rather than the main branch:
# the environment's manual approval gate becomes the control point, so a
# rejected approval means no token is ever issued and credentials are
# unobtainable.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "github_production_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    # AWS requires this exact audience value
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject}:environment:production"]
    }
  }
}

# -----------------------------------------------------------------------------
# Staging trust policy
#
# Branch-scoped, no environment gate — staging deploys are automatic.
# develop only. main was previously included so that production's build job
# could borrow this role's ECR access; that access now lives in github_build,
# so staging's boundary no longer depends on how production builds.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "github_staging_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject}:ref:refs/heads/develop"]
    }
  }
}

# -----------------------------------------------------------------------------
# Build trust policy
#
# Both deployable branches, because both produce images. No environment gate:
# building an artifact is not the act that needs approval, deploying it is.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "github_build_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "${var.github_subject}:ref:refs/heads/develop",
        "${var.github_subject}:ref:refs/heads/main",
      ]
    }
  }
}

# ASCII only in these descriptions. IAM validates role descriptions against
# a charset that admits printable ASCII and Latin-1 but excludes the em dash
# (U+2014) used elsewhere in this file; CreateRole fails with a 400. IAM
# *policy* descriptions accept it, so the failure only surfaces on roles.
resource "aws_iam_role" "github_production" {
  name               = "nahuat-github-actions-production"
  assume_role_policy = data.aws_iam_policy_document.github_production_trust.json
  description        = "Assumed by GitHub Actions for production deployments; requires manual approval"
}

resource "aws_iam_role" "github_staging" {
  name               = "nahuat-github-actions-staging"
  assume_role_policy = data.aws_iam_policy_document.github_staging_trust.json
  description        = "Assumed by GitHub Actions for staging deployments; automatic on develop push"
}

resource "aws_iam_role" "github_build" {
  name               = "nahuat-github-actions-build"
  assume_role_policy = data.aws_iam_policy_document.github_build_trust.json
  description        = "Assumed by GitHub Actions to push container images; no deploy or infrastructure rights"
}


# -----------------------------------------------------------------------------
# Production permissions — deploy only
#
# This role never runs terraform apply. Production infrastructure changes are
# applied by a human with their own credentials; CI only ships artifacts that
# were already built and promotes them onto running services.
#
# That reduces the role to: read state outputs, restart services with the new
# image, run the migration task, update Lambda code. No create/delete rights
# on any infrastructure, no secrets access, no IAM management.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "github_production" {

  # terraform init + output, to discover cluster/subnet/security-group IDs
  # at deploy time rather than hardcoding them in the workflow. Read-only:
  # no PutObject, so this role cannot write state or take a lock.
  statement {
    sid     = "ReadProductionState"
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::nahuat-terraform-state/production/*",
    ]
  }

  statement {
    sid       = "ListStateBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::nahuat-terraform-state"]
  }

  # Describe/List calls in ECS largely do not support resource-level
  # permissions, so they are unscoped. They are read-only metadata; the
  # mutating actions below carry the ARN constraints that matter.
  statement {
    sid    = "InspectEcs"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTasks",
      "ecs:DescribeTaskDefinition",
      "ecs:ListTasks",
    ]
    resources = ["*"]
  }

  # Unscoped because RegisterTaskDefinition supports no resource-level
  # permissions at all. PassProductionTaskRoles below is the real bound: a
  # revision is only useful if it can name roles to run as.
  statement {
    sid       = "RegisterProductionTaskDefinition"
    effect    = "Allow"
    actions   = ["ecs:RegisterTaskDefinition"]
    resources = ["*"]
  }

  # Points a service at the revision registered above.
  statement {
    sid     = "DeployProductionServices"
    effect  = "Allow"
    actions = ["ecs:UpdateService"]
    resources = [
      "arn:aws:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:service/nahuat-production/*",
    ]
  }

  # One-off migration task, constrained to the production cluster so a
  # production-scoped token cannot start tasks elsewhere.
  statement {
    sid     = "RunProductionMigrationTask"
    effect  = "Allow"
    actions = ["ecs:RunTask"]
    resources = [
      "arn:aws:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:task-definition/nahuat-production-*:*",
    ]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values = [
        "arn:aws:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:cluster/nahuat-production",
      ]
    }
  }

  # RunTask has to hand the task its execution and task roles. Scoped to
  # production roles: this is the one privilege-escalation surface the
  # production role has, so it is bounded by what those roles can do.
  statement {
    sid     = "PassProductionTaskRoles"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/nahuat-production-*",
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid    = "UpdateProductionLambdaCode"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:GetFunction",
      "lambda:PublishVersion",
    ]
    resources = [
      "arn:aws:lambda:us-east-1:${data.aws_caller_identity.current.account_id}:function:nahuat-production-*",
    ]
  }
}

# -----------------------------------------------------------------------------
# Build permissions — push images, nothing else
#
# Separate from the staging role so that the artifact production runs is not
# produced by an identity holding staging's infrastructure rights.
# Rationale: docs/adr/0001-ci-iam-boundaries.md
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "github_build" {
  # GetAuthorizationToken has no resource-level scoping in ECR.
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # The read actions are not redundant: buildx pulls previous layers from the
  # registry for its cache, so a push-only grant would rebuild from scratch
  # every run.
  #
  # DescribeImageScanFindings is what lets the deploy workflow read the scan
  # the registry already performs on push. Both repositories set
  # scanOnPush = true and, until this was added, nothing could read the result
  # — the findings existed and only the console could see them. Read-only, and
  # on the same two repositories as everything else here.
  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeImageScanFindings",
    ]
    resources = [
      aws_ecr_repository.api.arn,
      aws_ecr_repository.web.arn,
      aws_ecr_repository.media_consumer.arn,
    ]
  }
}

# -----------------------------------------------------------------------------
# Staging permissions — apply the staging application layer, deploy
#
# Broader than production because this role does run terraform apply and
# destroy against environments/staging/application. Scope is bounded three
# ways: an allow-list of the service prefixes that layer actually creates,
# a region condition, and the explicit Deny blocks at the end.
#
# Adding a new resource type to the staging application layer will fail with
# AccessDenied until its service prefix is added to StagingTerraform below.
# That is the intended tradeoff — a loud, localized failure in a staging
# workflow, instead of a standing wildcard.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "github_staging" {

  # Reads the foundation layer's outputs, writes its own state and lock
  # file. Production state keys are unreachable (and denied below).
  statement {
    sid     = "ReadStagingAndGlobalState"
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::nahuat-terraform-state/staging/*",
      "arn:aws:s3:::nahuat-terraform-state/global/*",
    ]
  }

  statement {
    sid    = "WriteStagingApplicationState"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      "arn:aws:s3:::nahuat-terraform-state/staging/application/*",
    ]
  }

  statement {
    sid       = "ListStateBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::nahuat-terraform-state"]
  }

  # The resource types the staging application layer manages. Wildcarded per
  # service rather than per action: action-level lists break on every
  # provider upgrade, service-level ones do not, and the Deny blocks below
  # are what actually contain this.
  statement {
    sid    = "StagingTerraform"
    effect = "Allow"
    actions = [
      "rds:*",
      "elasticache:*",
      "ecs:*",
      "elasticloadbalancing:*",
      "application-autoscaling:*",
      "sqs:*",
      "lambda:*",
      "sns:*",
      "cloudwatch:*",
      "logs:*",
      "ec2:Describe*",
      "kms:Describe*",
      "kms:ListAliases",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = ["us-east-1"]
    }
  }

  # ---------------------------------------------------------------------------
  # NAT gateway — the only EC2 write access this role has, because modules/nat
  # lives in the application layer so staging teardown releases the gateway.
  #
  # Three statements because create and destroy cannot be constrained alike.
  # ---------------------------------------------------------------------------

  # Unscoped because there is nothing to scope against: the gateway and address
  # do not exist when the call is authorized, so a resource-tag condition would
  # evaluate against an untagged resource and deny every time.
  statement {
    sid    = "StagingNatProvision"
    effect = "Allow"
    actions = [
      "ec2:AllocateAddress",
      "ec2:CreateNatGateway",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = ["us-east-1"]
    }
  }

  # Fenced by tag, not left on "*", and this is not ceremonial: CreateRoute
  # targets a route table owned by the FOUNDATION layer, so without the
  # condition this role could redirect all production egress or delete
  # production's NAT gateway. DenyProductionResources below lists no EC2 ARNs,
  # so this condition is the only thing closing that path.
  statement {
    sid    = "StagingNatMutate"
    effect = "Allow"
    actions = [
      "ec2:CreateRoute",
      "ec2:DeleteRoute",
      "ec2:ReplaceRoute",
      "ec2:DeleteNatGateway",
      "ec2:ReleaseAddress",
      "ec2:DeleteTags",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/Environment"
      values   = ["staging"]
    }
  }

  # Releasing an EIP that is still attached requires disassociating it first,
  # and Terraform does both in one destroy. This cannot carry the tag condition
  # used below: DisassociateAddress authorizes against the network interface as
  # well as the address, and a NAT gateway's ENI is created by AWS without our
  # default_tags, so the condition would evaluate against an untagged resource
  # and deny every time. Bounded by region here and by DenyProductionEc2 below.
  statement {
    sid       = "StagingNatDisassociate"
    effect    = "Allow"
    actions   = ["ec2:DisassociateAddress"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = ["us-east-1"]
    }
  }

  # ec2:CreateAction confines this to tags applied during resource creation.
  # Consequence: a tag-only change to an existing gateway, address or instance
  # is a bare CreateTags with no CreateAction context and will be denied. Rare,
  # and it fails loudly rather than silently.
  #
  # RunInstances is listed because the bastion is tagged by the same call that
  # creates it. Note where this one bites: teardown never reaches it, so a
  # missing entry here surfaces on the next bring-up rather than the destroy
  # that preceded it.
  statement {
    sid       = "StagingTagOnCreate"
    effect    = "Allow"
    actions   = ["ec2:CreateTags"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "ec2:CreateAction"
      values   = ["CreateNatGateway", "AllocateAddress", "RunInstances"]
    }
  }

  # ---------------------------------------------------------------------------
  # Bastion — modules/bastion, an EC2 instance instantiated from the
  # application layer so a teardown removes it and it bills only while the
  # environment is up.
  #
  # Split into three statements for the same reason the NAT grants above are:
  # create and destroy cannot be constrained alike.
  # ---------------------------------------------------------------------------

  # The AMI is resolved from an AWS-owned public parameter rather than one of
  # ours. Note the EMPTY account field in the ARN — that is what makes it AWS's
  # parameter rather than this account's. An ARN carrying the account id here
  # matches nothing and denies every plan.
  statement {
    sid       = "StagingBastionAmi"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:us-east-1::parameter/aws/service/ami-amazon-linux-latest/*"]
  }

  # Unscopable for the same reason as StagingNatProvision: the instance does
  # not exist when RunInstances is authorized, so a resource-tag condition
  # would evaluate against an untagged resource and deny every time. Bounded by
  # region here, by DenyProductionEc2 below, and by the fact that the only role
  # this document can pass to an instance is a nahuat-* one.
  statement {
    sid       = "StagingBastionProvision"
    effect    = "Allow"
    actions   = ["ec2:RunInstances"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = ["us-east-1"]
    }
  }

  # Fenced by tag rather than left on region alone: by the time an instance can
  # be terminated it carries Environment from the provider's default_tags, so
  # the condition that cannot work on create is available here.
  statement {
    sid       = "StagingBastionTerminate"
    effect    = "Allow"
    actions   = ["ec2:TerminateInstances"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/Environment"
      values   = ["staging"]
    }
  }

  # Secrets: read metadata and values for staging only. The AWS-managed RDS
  # master secret is created by RDS itself, hence the second ARN pattern.
  statement {
    sid    = "StagingSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:ListSecretVersionIds",
    ]
    resources = [
      "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:nahuat/staging/*",
      "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:rds!*",
    ]
  }

  # ---------------------------------------------------------------------------
  # RDS-managed master password
  #
  # modules/database sets manage_master_user_password, so RDS creates the
  # credentials secret AS THE CALLER rather than as a service principal.
  # Without CreateSecret the entire CreateDBInstance call fails with a 403 that
  # names Secrets Manager and never mentions RDS — the permission that is
  # missing is not the one the failing API suggests.
  #
  # Unfenced by tag because neither the secret nor its tags exist when the call
  # is authorized. Bounded instead by the rds! prefix, which only RDS creates,
  # and by DenyProductionResources below barring this role from creating a
  # production database in the first place.
  # ---------------------------------------------------------------------------
  statement {
    sid    = "StagingRdsSecretCreate"
    effect = "Allow"
    actions = [
      "secretsmanager:CreateSecret",
      "secretsmanager:TagResource",
    ]
    resources = [
      "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:rds!*",
    ]
  }

  # Teardown, which staging does routinely. Fenced by tag: RDS-managed secrets
  # inherit the provider's default_tags, so Environment distinguishes staging's
  # from production's. The name cannot — both are rds!db-<uuid>, and the uuid
  # is not predictable.
  statement {
    sid    = "StagingRdsSecretTeardown"
    effect = "Allow"
    actions = [
      "secretsmanager:DeleteSecret",
    ]
    resources = [
      "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:rds!*",
    ]

    condition {
      test     = "StringEquals"
      variable = "secretsmanager:ResourceTag/Environment"
      values   = ["staging"]
    }
  }

  # DNS records for the staging ALB, confined to this project's zone.
  # Route 53 is global, so it is scoped by ARN rather than by region.
  statement {
    sid    = "StagingDnsRecords"
    effect = "Allow"
    actions = [
      "route53:ChangeResourceRecordSets",
      "route53:ListResourceRecordSets",
      "route53:GetHostedZone",
      "route53:GetChange",
    ]
    resources = [
      aws_route53_zone.nahuat.arn,
      "arn:aws:route53:::change/*",
    ]
  }

  # Task, execution, and Lambda roles created by the application layer.
  # Confined to the nahuat- prefix; the CI roles themselves are carved out
  # by the Deny below.
  statement {
    sid    = "StagingServiceRoles"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:PassRole",
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/nahuat-*",
    ]
  }

  # An instance profile is a distinct IAM resource from the role it carries: its
  # own ARN namespace, its own actions. StagingServiceRoles above therefore does
  # not reach it, and modules/bastion needs both — the role for the SSM agent's
  # permissions, the profile to attach that role to an instance. Same nahuat-*
  # scoping, and DenyProductionResources below carves production out of it.
  statement {
    sid    = "StagingInstanceProfiles"
    effect = "Allow"
    actions = [
      "iam:CreateInstanceProfile",
      "iam:DeleteInstanceProfile",
      "iam:GetInstanceProfile",
      "iam:AddRoleToInstanceProfile",
      "iam:RemoveRoleFromInstanceProfile",
      "iam:TagInstanceProfile",
      "iam:UntagInstanceProfile",
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:instance-profile/nahuat-*",
    ]
  }

  statement {
    sid    = "StagingServicePolicies"
    effect = "Allow"
    actions = [
      "iam:CreatePolicy",
      "iam:DeletePolicy",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicyVersion",
      "iam:TagPolicy",
    ]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/nahuat-*",
    ]
  }

  # ---------------------------------------------------------------------------
  # Deny blocks. Explicit Deny overrides every Allow above, including the
  # service wildcards, so these are the real boundaries of this role.
  # Threat model and reachability analysis: docs/adr/0001-ci-iam-boundaries.md
  # ---------------------------------------------------------------------------

  # CLOSES: staging automation reaching production. This role is obtained by any
  # push to develop with no approval, and StagingTerraform grants compute and
  # data-service wildcards on Resource "*".
  #
  # The instance-profile ARN pairs with StagingInstanceProfiles above, and the
  # pairing is the rule worth reading off this file: every Allow scoped to
  # nahuat-* reaches production, because production's resources match that
  # prefix too. Widening one of those Allows without extending this list is how
  # a boundary opens silently.
  statement {
    sid     = "DenyProductionResources"
    effect  = "Deny"
    actions = ["*"]
    resources = [
      "arn:aws:s3:::nahuat-terraform-state/production/*",
      "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:nahuat/production/*",
      "arn:aws:rds:us-east-1:${data.aws_caller_identity.current.account_id}:db:nahuat-production*",
      "arn:aws:rds:us-east-1:${data.aws_caller_identity.current.account_id}:subgrp:nahuat-production*",
      "arn:aws:elasticache:us-east-1:${data.aws_caller_identity.current.account_id}:*:nahuat-production*",
      "arn:aws:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:cluster/nahuat-production",
      "arn:aws:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:service/nahuat-production/*",
      "arn:aws:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:task-definition/nahuat-production-*:*",
      "arn:aws:lambda:us-east-1:${data.aws_caller_identity.current.account_id}:function:nahuat-production-*",
      "arn:aws:sqs:us-east-1:${data.aws_caller_identity.current.account_id}:nahuat-production-*",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/nahuat-production-*",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:instance-profile/nahuat-production-*",
    ]
  }

  # CLOSES: the unscopable EC2 grants above reaching production. Every EC2
  # resource this project creates carries Environment from the provider's
  # default_tags, so denying on that tag is precise where a resource-ARN list
  # cannot be — EIP and NAT gateway IDs are generated, not predictable.
  #
  # This is what makes StagingNatDisassociate safe to leave unfenced: without
  # it, that grant would allow detaching production's NAT gateway address and
  # cutting all production egress.
  statement {
    sid       = "DenyProductionEc2"
    effect    = "Deny"
    actions   = ["ec2:*"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/Environment"
      values   = ["production"]
    }
  }

  # CLOSES: converting temporary CI credentials into permanent IAM user keys.
  #
  # Do not attempt to replace the ARN-prefix scoping on the IAM Allow
  # statements above with a region condition. aws:RequestedRegion cannot
  # constrain IAM: its endpoint lives in us-east-1, so a us-east-1 condition
  # ADMITS IAM calls rather than blocking them.
  statement {
    sid    = "DenyIamUserManagement"
    effect = "Deny"
    actions = [
      "iam:*User*",
      "iam:*Group*",
      "iam:*AccessKey*",
      "iam:*LoginProfile*",
      "iam:*ServiceSpecificCredential*",
      "iam:*MFADevice*",
    ]
    resources = ["*"]
  }

  # CLOSES: the CI roles rewriting their own permissions, and staging unlocking
  # production by editing production's trust policy. Reachable because
  # StagingServiceRoles and StagingServicePolicies span nahuat-*, and all three
  # CI roles match that prefix — so the naming convention is load-bearing here.
  #
  # ARNs are literal strings, not resource references: the roles and policies
  # consume this document, so referencing them creates a dependency cycle.
  statement {
    sid     = "DenyCicdSelfModification"
    effect  = "Deny"
    actions = ["iam:*"]
    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/nahuat-github-actions-*",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/nahuat-github-actions-*",
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com",
    ]
  }
}

resource "aws_iam_policy" "github_production" {
  name        = "nahuat-github-actions-production"
  description = "Production CI/CD — deploy prebuilt artifacts only, no terraform apply"
  policy      = data.aws_iam_policy_document.github_production.json
}

resource "aws_iam_policy" "github_staging" {
  name        = "nahuat-github-actions-staging"
  description = "Staging CI/CD — terraform on the staging application layer, plus deploys"
  policy      = data.aws_iam_policy_document.github_staging.json
}

resource "aws_iam_policy" "github_build" {
  name        = "nahuat-github-actions-build"
  description = "Container image builds — ECR push only, for both environments"
  policy      = data.aws_iam_policy_document.github_build.json
}

resource "aws_iam_role_policy_attachment" "github_production" {
  role       = aws_iam_role.github_production.name
  policy_arn = aws_iam_policy.github_production.arn
}

resource "aws_iam_role_policy_attachment" "github_staging" {
  role       = aws_iam_role.github_staging.name
  policy_arn = aws_iam_policy.github_staging.arn
}

resource "aws_iam_role_policy_attachment" "github_build" {
  role       = aws_iam_role.github_build.name
  policy_arn = aws_iam_policy.github_build.arn
}
