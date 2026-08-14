# =============================================================================
# STAGING FOUNDATION
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

  vpc_cidr              = "10.1.0.0/16"
  public_subnet_a_cidr  = "10.1.1.0/24"
  public_subnet_b_cidr  = "10.1.2.0/24"
  private_subnet_a_cidr = "10.1.3.0/24"
  private_subnet_b_cidr = "10.1.4.0/24"
}

module "security" {
  source = "../../../modules/security"

  prefix = local.prefix
  vpc_id = module.networking.vpc_id
}

# =============================================================================
# S3
# =============================================================================

# Audio recordings and images, served only through the CDN distribution.
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
      <title>Nahuat Platform — Staging</title>
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
        .env { display: inline-block; background: #f0e6ff; color: #6b21a8;
               font-size: 0.75rem; padding: 2px 8px; border-radius: 99px;
               margin-bottom: 1rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <span class="env">staging</span>
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
# CDN — cdn.staging.nahuat.com
#
# Asset keys embed a timestamp and nanoid, so a changed file is always a new
# URL. That makes invalidation unnecessary and a one-year TTL safe.
# -----------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "cdn" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Nahuat CDN - audio and image assets"
  price_class     = "PriceClass_100" # US + Europe; adequate for Central America

  # cdn-staging, not cdn.staging: the ACM certificate is *.nahuat.com, which
  # matches exactly ONE label. "cdn.staging.nahuat.com" is two and CloudFront
  # rejects the distribution with InvalidViewerCertificate. Same rule that
  # forced alb-{env} below.
  aliases = ["cdn-staging.nahuat.com"]

  origin {
    origin_id                = "s3-assets"
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
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
      Resource  = "${aws_s3_bucket.assets.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn }
      }
    }]
  })
}

# -----------------------------------------------------------------------------
# Web — staging.nahuat.com
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
  comment         = "Nahuat web app - staging"
  price_class     = "PriceClass_100"

  # No default_root_object: it rewrites a request for / into a request for
  # /index.html, which an SSR Next.js origin has no route for and answers with
  # a 404. It is an S3-static-hosting setting, not a fit for this origin.

  # No www for staging. "www.staging.nahuat.com" is two labels and therefore
  # outside the *.nahuat.com certificate; a www-staging.nahuat.com alias would
  # be covered but nobody types www at a staging host. Production keeps its www.
  aliases = ["staging.nahuat.com"]

  origin {
    origin_id   = "alb"
    domain_name = "alb-${var.environment}.nahuat.com"

    custom_origin_config {
      http_port  = 80
      https_port = 443
      # https-only, and not optional: the ALB's port-80 listener 301-redirects
      # to HTTPS, so an http-only origin produces an infinite redirect loop
      # (CloudFront -> ALB -> 301 -> CloudFront). This also makes the path
      # end-to-end encrypted.
      #
      # The origin hostname is alb-{env}.nahuat.com rather than
      # alb.{env}.nahuat.com because CloudFront validates the origin's
      # certificate against that name, and *.nahuat.com matches exactly one
      # label — "alb.production" is two.
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
# api.staging.nahuat.com and alb.staging.nahuat.com are created by the application
# layer, which owns the ALB they point at.
# =============================================================================

resource "aws_route53_record" "root" {
  zone_id = data.terraform_remote_state.global.outputs.route53_zone_id
  name    = "staging.nahuat.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "cdn" {
  zone_id = data.terraform_remote_state.global.outputs.route53_zone_id
  name    = "cdn-staging.nahuat.com"
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

resource "aws_secretsmanager_secret" "auth0" {
  name                    = "nahuat/${var.environment}/auth0"
  description             = "Auth0 application credentials - set manually from the Auth0 dashboard"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "auth0_mgmt" {
  name                    = "nahuat/${var.environment}/auth0-mgmt"
  description             = "Auth0 Management API credentials - set manually from the Auth0 dashboard"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "internal" {
  name                    = "nahuat/${var.environment}/internal"
  description             = "Shared secret for the internal /auth/role endpoint - openssl rand -base64 32"
  recovery_window_in_days = 7
}
