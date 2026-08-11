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
# One repo per image, shared across environments: an image is built once and
# promoted by tag, so what runs in production is the exact artifact that
# passed staging.
#
# Tags: prod-{sha} and latest (production), staging-{sha} (staging).
# The lifecycle rules below key off those prefixes.
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "api" {
  name                 = "nahuat-api"
  image_tag_mutability = "MUTABLE" # required to move the :latest tag

  image_scanning_configuration {
    scan_on_push = true # no cost
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "nahuat-web"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Shared by both repos — caps storage cost (~$0.10/GB/month)
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
      values   = ["repo:${var.github_repo}:environment:production"]
    }
  }
}

# -----------------------------------------------------------------------------
# Staging trust policy
#
# Branch-scoped, no environment gate — staging deploys are automatic.
# main is included so production releases can be validated against staging
# before promotion.
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
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repo}:ref:refs/heads/develop",
        "repo:${var.github_repo}:ref:refs/heads/main",
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

  # Rolling deploy: --force-new-deployment against the existing task
  # definition, which already points at the :latest image tag.
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
# Staging permissions — build, apply the staging application layer, deploy
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

  # Image builds for BOTH environments run under this role — the ECR repos
  # are shared, and production's deploy job only promotes what was pushed
  # here. GetAuthorizationToken has no resource-level scoping in ECR.
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

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
    ]
    resources = [
      aws_ecr_repository.api.arn,
      aws_ecr_repository.web.arn,
    ]
  }

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
  #
  # Each block records the escalation path it closes and whether that path is
  # reachable today, so a future edit that widens an Allow can be weighed
  # against what these were protecting.
  # ---------------------------------------------------------------------------

  # CLOSES: staging automation reaching production.
  #
  # This role is assumed with no approval — every push to develop obtains it.
  # StagingTerraform grants rds:*, ecs:*, lambda:*, sqs:* and elasticache:* on
  # Resource "*", so without this block a workflow on develop could delete the
  # production database or push a deployment onto production services. The
  # production environment's approval gate would then be decorative: it gates
  # the production ROLE while an ungated role holds equivalent power over the
  # same resources.
  #
  # REACHABLE TODAY for those compute and data services. The state-file and
  # secrets ARNs are defence in depth — ReadStagingAndGlobalState and
  # StagingSecrets are already prefix-scoped, so those paths are shut; this
  # keeps them shut if either statement is later widened.
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
    ]
  }

  # CLOSES: converting temporary CI credentials into permanent ones.
  #
  # The escalation is iam:CreateUser → iam:AttachUserPolicy (Administrator
  # Access) → iam:CreateAccessKey, which yields long-lived keys that outlive
  # the 1-hour OIDC session, survive rotation of everything else, and are not
  # bounded by region. Nothing in this architecture uses IAM users, so denying
  # the whole surface costs nothing.
  #
  # NOT REACHABLE TODAY — no Allow above grants user, group, or access-key
  # actions. This is the backstop that keeps that true, and it matters because
  # the obvious guard does not work: aws:RequestedRegion cannot constrain IAM.
  # IAM's endpoint lives in us-east-1, so a us-east-1 region condition ADMITS
  # IAM calls rather than blocking them. That is why the IAM Allow statements
  # above are scoped by ARN prefix instead of by region.
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

  # CLOSES: the CI roles rewriting their own permissions, and staging
  # unlocking production by editing production's trust policy.
  #
  # This is the sharpest hole in the design, and it exists because of a name
  # collision: StagingServiceRoles allows iam:PutRolePolicy,
  # iam:AttachRolePolicy and iam:UpdateAssumeRolePolicy across role/nahuat-*,
  # and BOTH CI roles are named nahuat-github-actions-*. Two escalations
  # follow from that overlap:
  #
  #   1. iam:PutRolePolicy on its own role → attach Action "*" → every
  #      restriction in this document becomes self-removable, making the
  #      least-privilege split above worthless.
  #   2. iam:UpdateAssumeRolePolicy on nahuat-github-actions-production →
  #      widen its trust to any branch → assume the production role with no
  #      environment approval, bypassing the gate entirely.
  #
  # StagingServicePolicies opens the same door via iam:CreatePolicyVersion on
  # policy/nahuat-*. The OIDC provider is included because editing its
  # thumbprint or client IDs subverts the federation these roles depend on.
  #
  # REACHABLE TODAY, and the reason this block is not optional.
  #
  # ARNs are written as literal strings rather than resource references
  # (aws_iam_role.github_staging.arn and friends) because those resources
  # consume this document — referencing them here creates a dependency cycle.
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
  description = "Staging CI/CD — image builds plus terraform on the staging application layer"
  policy      = data.aws_iam_policy_document.github_staging.json
}

resource "aws_iam_role_policy_attachment" "github_production" {
  role       = aws_iam_role.github_production.name
  policy_arn = aws_iam_policy.github_production.arn
}

resource "aws_iam_role_policy_attachment" "github_staging" {
  role       = aws_iam_role.github_staging.name
  policy_arn = aws_iam_policy.github_staging.arn
}
