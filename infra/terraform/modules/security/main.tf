# =============================================================================
# MODULE: SECURITY GROUPS
#
# All groups live here so the relationships between them are visible in one
# place. They belong to the foundation layer because the application layer
# references their IDs — keeping them stable across application destroy and
# recreate cycles.
#
# Ingress is source-restricted and, wherever possible, matches on another
# security group rather than a CIDR: that survives ECS tasks being replaced
# with new IPs. Egress is open on all of them; the ingress rules are what
# actually constrain reachability.
# =============================================================================

# -----------------------------------------------------------------------------
# ALB
#
# Port 80 is open alongside 443 so the listener can answer with a redirect.
# Blocking it entirely would give anyone typing a bare hostname a connection
# refused rather than an upgrade to HTTPS.
# -----------------------------------------------------------------------------
resource "aws_security_group" "alb" {
  name        = "${var.prefix}-alb"
  description = "ALB - accepts HTTPS/HTTP from the internet, forwards to ECS"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP from internet, redirected to HTTPS by the listener"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.prefix}-alb" }
}

# -----------------------------------------------------------------------------
# ECS API — NestJS
#
# Outbound needs: RDS 5432, Redis 6379, and 443 through NAT for Auth0 JWKS
# and Management API calls.
# -----------------------------------------------------------------------------
resource "aws_security_group" "ecs_api" {
  name        = "${var.prefix}-ecs-api"
  description = "ECS NestJS API - accepts traffic from the ALB only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "NestJS from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.prefix}-ecs-api" }
}

# -----------------------------------------------------------------------------
# ECS Web — Next.js
#
# Server-side rendering calls the API through api.{env}.nahuat.com, which
# resolves to the ALB, so that traffic re-enters via the ALB security group
# rather than going host to host.
# -----------------------------------------------------------------------------
resource "aws_security_group" "ecs_web" {
  name        = "${var.prefix}-ecs-web"
  description = "ECS Next.js web - accepts traffic from the ALB only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Next.js from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.prefix}-ecs-web" }
}

# -----------------------------------------------------------------------------
# RDS PostgreSQL
#
# Private subnets only, publicly_accessible = false on the instance. Two
# separate ingress rules because a single rule cannot list multiple source
# security groups.
# -----------------------------------------------------------------------------
resource "aws_security_group" "rds" {
  name        = "${var.prefix}-rds"
  description = "RDS PostgreSQL - accepts connections from ECS API and Lambda only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from ECS API"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_api.id]
  }

  ingress {
    description     = "PostgreSQL from Lambda consumers"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.prefix}-rds" }
}

# -----------------------------------------------------------------------------
# ElastiCache Valkey
#
# TRADEOFF: only cache-invalidation-consumer needs Redis, but all four Lambdas
# share one security group, so all four can reach it. Per-consumer groups would
# close that gap at the cost of four more groups and four more rules to keep in
# sync — not worth it while the consumers are all first-party code in this repo.
#
# There is no AUTH token either: access is controlled by VPC placement and this
# group alone. See the backlog entry on Redis AUTH.
# -----------------------------------------------------------------------------
resource "aws_security_group" "redis" {
  name        = "${var.prefix}-redis"
  description = "ElastiCache Valkey - accepts connections from ECS API and Lambda"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from ECS API (rate limiting, caching)"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_api.id]
  }

  ingress {
    description     = "Redis from Lambda (cache-invalidation-consumer)"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.prefix}-redis" }
}

# -----------------------------------------------------------------------------
# Lambda consumers
#
# No ingress rules, deliberately: SQS does not deliver over the VPC network.
# The event source mapping invokes the function through the Lambda service
# plane, so nothing needs to reach these ENIs inbound.
#
# Outbound covers RDS, Redis, and 443 via NAT for the CloudFront API used by
# cdn-invalidation-consumer.
# -----------------------------------------------------------------------------
resource "aws_security_group" "lambda" {
  name        = "${var.prefix}-lambda"
  description = "Lambda consumers - VPC attached for RDS and Redis access"
  vpc_id      = var.vpc_id

  egress {
    description = "All outbound - RDS, Redis, and CloudFront API via NAT"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.prefix}-lambda" }
}
