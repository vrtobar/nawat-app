# =============================================================================
# PRODUCTION FOUNDATION
#
# Always-on resources. NEVER run terraform destroy on this layer: the
# application layer is designed to be torn down and rebuilt against these
# stable VPC, security group, and CloudFront IDs.
#
# Run order (first time): global apply -> this -> set the Auth0 and internal
# secret values by hand -> application apply.
# =============================================================================

locals {
  prefix = "nahuat-${var.environment}"
}

data "terraform_remote_state" "global" {
  backend = "s3"
  config = {
    bucket = "nahuat-terraform-state"
    key    = "global/terraform.tfstate"
    region = "us-east-1"
  }
}

# S3 bucket names are globally unique across all AWS accounts, so the account
# ID is appended to avoid collisions with unrelated buckets.
data "aws_caller_identity" "current" {}

# =============================================================================
# NETWORKING AND SECURITY GROUPS
# =============================================================================

module "networking" {
  source = "../../../modules/networking"

  prefix               = local.prefix
  region               = var.region
  single_az_mode       = var.single_az_mode
  enable_vpc_endpoints = var.enable_vpc_endpoints

  vpc_cidr              = "10.0.0.0/16"
  public_subnet_a_cidr  = "10.0.1.0/24"
  public_subnet_b_cidr  = "10.0.2.0/24"
  private_subnet_a_cidr = "10.0.3.0/24"
  private_subnet_b_cidr = "10.0.4.0/24"
}

module "security" {
  source = "../../../modules/security"

  prefix = local.prefix
  vpc_id = module.networking.vpc_id
}

# =============================================================================
# S3
# =============================================================================

# Audio recordings and images. THREE PREFIXES, and the split is a security
# boundary rather than filing (docs/adr/0020):
#
#   source/   original uploads — never served, never moved, kept permanently
#   pending/  processed derivatives awaiting ADMIN review
#   public/   approved; the only prefix this bucket's CDN can read
#
# Publication is a COPY between prefixes, not a flag on a row, which is what
# makes unapproved media unreachable rather than merely unlinked. The CDN
# distribution below enforces it twice, in its origin path and in the grant.
#
# Versioning is on because a re-uploaded recording would otherwise be
# unrecoverable, and the language content is the part of this project that
# cannot be regenerated.
resource "aws_s3_bucket" "assets" {
  bucket = "${local.prefix}-assets-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Dictionary exports — prisma/export.ts writes a JSON snapshot of entries and
# translations, infra/scripts/dictionary-backup.sh puts it here.
#
# THE POINT OF THIS BUCKET IS WHICH LAYER IT IS IN. RDS lives in the
# application layer, so `terraform destroy` on that layer takes the content
# with it; ADR 17 makes exactly that a routine pre-launch operation. Foundation
# survives, so this does too, and a restore into a rebuilt environment reads
# from a bucket that never went away.
#
# Not a database backup — that is an RDS snapshot. This is the portable half:
# content, in a form that can be read, diffed and imported into an environment
# that does not exist yet.
resource "aws_s3_bucket" "backups" {
  bucket = "${local.prefix}-backups-${data.aws_caller_identity.current.account_id}"
}

# Versioning matters more here than on assets. An export is written to a
# predictable key, so a bad export — taken against a half-restored database,
# say — would otherwise overwrite the good one it was meant to supersede.
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Superseded versions are kept long enough to undo a mistake nobody noticed for
# a while, then expire. Current versions are never expired: the newest export is
# the only copy of the dictionary while every environment is torn down.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    # A multipart upload that failed partway leaves parts that are billed and
    # invisible in the console's object list.
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Served by CloudFront when the ALB is unreachable, which includes the
# expected case of the application layer being destroyed.
resource "aws_s3_bucket" "maintenance" {
  bucket = "${local.prefix}-maintenance-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "maintenance" {
  bucket = aws_s3_bucket.maintenance.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Everything inline — this page has to render when the origin serving the
# app's CSS and assets is exactly what is down.
resource "aws_s3_object" "maintenance_page" {
  bucket       = aws_s3_bucket.maintenance.id
  key          = "maintenance.html"
  content_type = "text/html"

  content = <<-HTML
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Nahuat Platform</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: system-ui, -apple-system, sans-serif;
          display: flex; align-items: center; justify-content: center;
          min-height: 100vh; background: #fafaf8; color: #1a1a1a;
        }
        .card { text-align: center; padding: 2rem; max-width: 440px; }
        h1 { font-size: 1.5rem; margin-bottom: 0.75rem; }
        p { color: #555; line-height: 1.6; margin-bottom: 0.5rem; }
        .small { font-size: 0.875rem; color: #888; margin-top: 1rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Nahuat Platform</h1>
        <p>We are performing scheduled maintenance.</p>
        <p>Preserving the Nawat language of El Salvador.</p>
        <p class="small">We'll be back shortly.</p>
      </div>
    </body>
    </html>
  HTML
}

# =============================================================================
# CLOUDFRONT
# =============================================================================

# Origin Access Control replaces the legacy Origin Access Identity: CloudFront
# signs requests with SigV4, so the buckets stay fully private.
resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${local.prefix}-s3-oac"
  description                       = "OAC for S3 origins - assets and maintenance"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# -----------------------------------------------------------------------------
# CDN — cdn.nahuat.com
#
# Asset keys embed a timestamp and nanoid, so a changed file is always a new
# URL. That makes invalidation unnecessary and a one-year TTL safe.
# -----------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "cdn" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Nahuat CDN - audio and image assets"
  price_class     = "PriceClass_100" # US + Europe; adequate for Central America

  aliases = ["cdn.nahuat.com"]

  origin {
    origin_id                = "s3-assets"
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id

    # THE APPROVAL GATE, EXPRESSED AS A ROUTE. The assets bucket holds three
    # prefixes (docs/adr/0020): `source/` for original uploads, `pending/` for
    # processed derivatives awaiting review, and `public/` for approved ones.
    # This path prepends `/public` to every request, so no URL a viewer can
    # construct reaches the other two — `cdn.nahuat.com/pending/x` asks the
    # origin for `public/pending/x` and gets a 404.
    #
    # Without it the gate is a convention that holds only until someone shares
    # a key. The bucket policy below narrows the grant to match; both are
    # needed, since either alone leaves the objects reachable.
    origin_path = "/public"
  }

  default_cache_behavior {
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6" # managed CachingOptimized
  }

  viewer_certificate {
    acm_certificate_arn      = data.terraform_remote_state.global.outputs.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Name = "${local.prefix}-cdn" }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      # `public/*`, not `*`. The origin path above already stops a viewer
      # addressing another prefix; this stops the distribution reading one at
      # all, so a later behaviour or origin added to this distribution cannot
      # widen the exposure by accident. Unapproved media is unreachable because
      # CloudFront is not permitted to fetch it, not merely because no route
      # points there.
      Resource = "${aws_s3_bucket.assets.arn}/public/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn }
      }
    }]
  })
}

# -----------------------------------------------------------------------------
# Web — nahuat.com
#
# The primary origin is the stable hostname alb.{env}.nahuat.com rather than
# the ALB's own DNS name. The application layer creates that record alongside
# the ALB, so when the application layer is destroyed the record disappears,
# CloudFront gets a 502, and the origin group fails over to the maintenance
# bucket. Foundation therefore never needs to learn the real ALB address, and
# tearing down the application layer requires no CloudFront change.
# -----------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "web" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Nahuat web app - nahuat.com"
  price_class     = "PriceClass_100"

  # No default_root_object: it rewrites a request for / into a request for
  # /index.html, which an SSR Next.js origin has no route for and answers with
  # a 404. It is an S3-static-hosting setting, not a fit for this origin.

  aliases = ["nahuat.com", "www.nahuat.com"]

  origin {
    origin_id   = "alb"
    domain_name = "alb.nahuat.com"

    custom_origin_config {
      http_port  = 80
      https_port = 443
      # https-only, and not optional: the ALB's port-80 listener 301-redirects
      # to HTTPS, so an http-only origin produces an infinite redirect loop
      # (CloudFront -> ALB -> 301 -> CloudFront). This also makes the path
      # end-to-end encrypted.
      #
      # CloudFront validates the origin's certificate against the origin
      # hostname, and *.nahuat.com matches exactly one label. alb.nahuat.com
      # is one and is covered; the earlier alb.production.nahuat.com was two,
      # which is what the hyphenated alb-production.nahuat.com worked around
      # until production dropped the environment label entirely.
      #
      # Set literally rather than interpolating var.environment: production
      # owns the apex, so there is no environment to substitute. Staging's
      # equivalent keeps the label as alb.staging.nahuat.com.
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]

      # How long CloudFront waits before treating the ALB as unreachable and
      # failing over.
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }
  }

  origin {
    origin_id                = "maintenance"
    domain_name              = aws_s3_bucket.maintenance.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  # Maintenance handling, deliberately NOT an origin group. CloudFront rejects
  # POST/PUT/PATCH/DELETE on any behavior targeting an origin group, and the
  # app needs them for Server Actions and form posts. Mapping origin errors to
  # a page served from S3 keeps every method available, and unlike failover it
  # covers "/" too: origin group failover re-requests the same path, and "/"
  # against a private bucket root is a 403 rather than the page.
  #
  # An unreachable origin — including the ALB DNS record vanishing with the
  # application layer — surfaces as a 502 here.
  custom_error_response {
    error_code            = 502
    response_code         = 503
    response_page_path    = "/maintenance.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 503
    response_code         = 503
    response_page_path    = "/maintenance.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 504
    response_code         = 503
    response_page_path    = "/maintenance.html"
    error_caching_min_ttl = 10
  }

  # HTML is never cached: every response is SSR output that may be
  # user-specific, so it has to reach the origin.
  default_cache_behavior {
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # managed CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # managed AllViewer
  }

  # The only path served from the maintenance bucket; custom_error_response
  # above points here.
  ordered_cache_behavior {
    path_pattern           = "/maintenance.html"
    target_origin_id       = "maintenance"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6" # managed CachingOptimized
  }

  # Next.js emits content-hashed filenames under /_next/static, so a code
  # change produces a new URL and a one-year TTL never serves stale assets.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6" # managed CachingOptimized
  }

  # public/ assets: favicons, OG images, robots.txt.
  ordered_cache_behavior {
    path_pattern           = "/static/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  viewer_certificate {
    acm_certificate_arn      = data.terraform_remote_state.global.outputs.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Name = "${local.prefix}-web" }
}

resource "aws_s3_bucket_policy" "maintenance" {
  bucket = aws_s3_bucket.maintenance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.maintenance.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web.arn }
      }
    }]
  })
}

# =============================================================================
# ROUTE53
# api.nahuat.com and alb.production.nahuat.com are created by the application
# layer, which owns the ALB they point at.
# =============================================================================

resource "aws_route53_record" "root" {
  zone_id = data.terraform_remote_state.global.outputs.route53_zone_id
  name    = "nahuat.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  zone_id = data.terraform_remote_state.global.outputs.route53_zone_id
  name    = "www.nahuat.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "cdn" {
  zone_id = data.terraform_remote_state.global.outputs.route53_zone_id
  name    = "cdn.nahuat.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

# =============================================================================
# SECRETS MANAGER — EMPTY SHELLS
#
# Created here so the ARNs are stable and the application layer's IAM policies
# can reference them, but the values are set by hand once per environment and
# never appear in Terraform state.
#
# There is deliberately no database secret: RDS is configured with
# manage_master_user_password, so AWS generates the password and owns its own
# secret, keeping it out of state entirely.
#
# recovery_window_in_days = 7 means a deleted secret is recoverable for a week
# rather than vanishing immediately.
# =============================================================================

resource "aws_secretsmanager_secret" "google" {
  name                    = "nahuat/${var.environment}/google"
  description             = "Google OAuth client for THIS environment - clientId and clientSecret, set manually from the Google Cloud console"
  recovery_window_in_days = 7
}

# The RS256 key set this API signs its own access tokens with (docs/adr/0018).
# A base64-encoded private JWK Set, not JSON with named keys — `auth:keygen`
# emits exactly the string this holds, so there is nothing to assemble by hand
# and nothing to get wrong assembling it.
#
# ⚠️ GENERATE IT SEPARATELY PER ENVIRONMENT. There is no defence behind this
# value: the API verifies against whatever key set it is given, so the key IS
# the boundary between environments. One key shared with staging means staging
# can mint access tokens production accepts.
resource "aws_secretsmanager_secret" "jwt_signing" {
  name                    = "nahuat/${var.environment}/jwt-signing"
  description             = "RS256 signing key set for this API's own access tokens - generate per environment with: npm run auth:keygen"
  recovery_window_in_days = 7
}

# Encrypts the web tier's session cookie. Its own secret rather than a key
# inside the Google one, because they answer to different trust boundaries and
# rotate for different reasons — this with `openssl rand -hex 32`, the other in
# a console. Sharing an ARN would have made the separation nominal: anything
# able to read one key reads every key in that secret.
resource "aws_secretsmanager_secret" "web_session" {
  name                    = "nahuat/${var.environment}/web-session"
  description             = "AUTH_SECRET - encrypts the Next.js session cookie. openssl rand -hex 32"
  recovery_window_in_days = 7
}
