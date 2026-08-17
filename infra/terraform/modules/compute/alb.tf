# =============================================================================
# MODULE: COMPUTE — LOAD BALANCER
#
# One ALB serves both services, split by Host header rather than path:
#   api_domain      → API target group
#   everything else → web target group
#
# A second ALB would double the ~$16/month fixed cost to separate two services
# that already have distinct hostnames.
# =============================================================================

resource "aws_lb" "main" {
  name               = "${var.prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [var.alb_sg_id]

  # Guards against `terraform destroy` racing ahead of in-flight requests.
  enable_deletion_protection = false

  # The ALB default. Comfortably above CloudFront's 30s origin_read_timeout,
  # so the CDN gives up first and controls the user-facing timeout rather than
  # the ALB cutting a request short underneath it.
  idle_timeout = 60

  # Without this, a client that opens a connection and sends nothing keeps a
  # target slot occupied.
  drop_invalid_header_fields = true

  tags = { Name = "${var.prefix}-alb" }
}

# -----------------------------------------------------------------------------
# Target groups
#
# target_type = "ip" is mandatory for Fargate: tasks have ENIs, not EC2
# instance IDs, so there is nothing to register by instance.
#
# Both target groups poll a LIVENESS endpoint: 200 whenever the process is up,
# no dependency checks. That is deliberate and was not always true — the API's
# /api/health queried Postgres until 2026-08-17, which meant a database blip
# marked every task unhealthy, ECS drained them all, and a hiccup that might
# resolve in seconds became a full outage.
#
# Dependency health is asked elsewhere, at a time when the answer is actionable:
# the API's /api/health/ready is checked by the production deploy workflow after
# a rollout. A load balancer is the wrong thing to tell about a database, because
# its only available response is to remove capacity.
# -----------------------------------------------------------------------------

resource "aws_lb_target_group" "api" {
  name        = "${var.prefix}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  deregistration_delay = var.deregistration_delay

  health_check {
    enabled             = true
    path                = "/api/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = var.health_check_interval
    timeout             = var.health_check_timeout
    healthy_threshold   = var.healthy_threshold
    unhealthy_threshold = var.unhealthy_threshold
  }

  tags = { Name = "${var.prefix}-api" }
}

resource "aws_lb_target_group" "web" {
  name        = "${var.prefix}-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  deregistration_delay = var.deregistration_delay

  # COUPLED CHANGE — this path must not be applied before the web image serving
  # it is deployed. The route is added in apps/web/app/api/health/route.ts; if
  # this applies first the ALB polls a 404, every web task fails its health
  # check, ECS drains them, and the circuit breaker rolls back — an outage
  # caused entirely by a health check change. Deploy the code, then apply.
  health_check {
    enabled             = true
    path                = "/api/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = var.health_check_interval
    timeout             = var.health_check_timeout
    healthy_threshold   = var.healthy_threshold
    unhealthy_threshold = var.unhealthy_threshold
  }

  tags = { Name = "${var.prefix}-web" }
}

# -----------------------------------------------------------------------------
# Listeners
#
# Port 80 exists only to redirect. CloudFront reaches the ALB over HTTP (see
# the origin_protocol_policy tradeoff in foundation), so this redirect serves
# anyone hitting the ALB hostname directly rather than through the CDN.
# -----------------------------------------------------------------------------

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.acm_certificate_arn

  # TLS 1.2 minimum, matching the CloudFront distributions.
  ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  # Anything without a matching host rule goes to the web app.
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# Host-based split. Priority is arbitrary but must be unique; the API is the
# only rule, so the web app remains the listener default.
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = [var.api_domain]
    }
  }
}
