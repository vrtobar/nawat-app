# =============================================================================
# MODULE: COMPUTE — CLUSTER, SERVICES, DNS, AUTOSCALING
# =============================================================================

resource "aws_ecs_cluster" "main" {
  name = "nahuat-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${var.prefix}-cluster" }
}

# -----------------------------------------------------------------------------
# Services
#
# Tasks run in private subnets with assign_public_ip = false, reaching the
# internet through the NAT gateway. Public subnets plus public IPs would save
# the gateway's ~$32/month but put the tasks one security group mistake away
# from being directly reachable.
#
# task_definition and desired_count are both ignored because Terraform is not
# the authority on either: CI moves the revision pointer on deploy, autoscaling
# moves the count. Without the ignores, the next apply reverts whichever one
# has moved since.
#
# task_definition may only be ignored while image tags are immutable. Under a
# floating tag CI never changes the revision, so ignoring it would mean
# Terraform's env var, secret, and sizing changes register new revisions that
# the service silently never adopts. The safety of this ignore depends on
# var.image_tag rejecting mutable tags, which its validation block enforces.
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "api" {
  name            = "${var.prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.ecs_subnet_ids
    security_groups  = [var.ecs_api_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  # Cold start plus Prisma client init plus the first database connection all
  # happen before /api/health can answer. Too short and ECS kills tasks that
  # were about to become healthy, producing an endless replacement loop.
  health_check_grace_period_seconds = var.health_check_grace_period

  deployment_minimum_healthy_percent = var.deployment_min_healthy_pct
  deployment_maximum_percent         = 200

  # Roll back automatically if the new revision never reaches steady state,
  # rather than leaving a half-deployed service.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # The listener rule must exist before targets register, or the ALB has
  # nowhere to route them.
  depends_on = [aws_lb_listener_rule.api]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = { Name = "${var.prefix}-api" }
}

resource "aws_ecs_service" "web" {
  name            = "${var.prefix}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.ecs_subnet_ids
    security_groups  = [var.ecs_web_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  health_check_grace_period_seconds = var.health_check_grace_period

  deployment_minimum_healthy_percent = var.deployment_min_healthy_pct
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.https]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = { Name = "${var.prefix}-web" }
}

# -----------------------------------------------------------------------------
# DNS
#
# alb.{environment}.nahuat.com is the load-bearing one: foundation's CloudFront
# distribution points at it permanently. Creating it here means destroying this
# layer removes it, CloudFront can no longer resolve its origin, and the
# maintenance page takes over — with no CloudFront change in either direction.
# -----------------------------------------------------------------------------

resource "aws_route53_record" "alb" {
  zone_id = var.route53_zone_id
  name    = var.alb_domain
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}

# The public API hostname, reached directly rather than through CloudFront —
# API responses are per-user and uncacheable, so the CDN would add a hop for
# nothing.
resource "aws_route53_record" "api" {
  zone_id = var.route53_zone_id
  name    = var.api_domain
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}

# -----------------------------------------------------------------------------
# Autoscaling — off by default
#
# Target tracking rather than step scaling: it needs one number instead of a
# ladder of thresholds, and CPU is the only signal that means anything before
# there is real traffic to characterise.
# -----------------------------------------------------------------------------

resource "aws_appautoscaling_target" "api" {
  count = var.enable_autoscaling ? 1 : 0

  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.autoscaling_min
  max_capacity       = var.autoscaling_max
}

resource "aws_appautoscaling_policy" "api_cpu" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${var.prefix}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api[0].service_namespace
  resource_id        = aws_appautoscaling_target.api[0].resource_id
  scalable_dimension = aws_appautoscaling_target.api[0].scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value = 70

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    scale_in_cooldown  = 600 # slow to shrink: avoids flapping on brief lulls
    scale_out_cooldown = 180 # quicker to grow: under-provisioned costs users
  }
}

resource "aws_appautoscaling_target" "web" {
  count = var.enable_autoscaling ? 1 : 0

  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.autoscaling_min
  max_capacity       = var.autoscaling_max
}

resource "aws_appautoscaling_policy" "web_cpu" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${var.prefix}-web-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.web[0].service_namespace
  resource_id        = aws_appautoscaling_target.web[0].resource_id
  scalable_dimension = aws_appautoscaling_target.web[0].scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value = 70

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    scale_in_cooldown  = 600
    scale_out_cooldown = 180
  }
}
