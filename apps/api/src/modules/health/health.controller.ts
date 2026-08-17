import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, type HealthCheckResult, HealthCheckService } from '@nestjs/terminus';

import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './prisma.health';

// Two different questions, deliberately answered at two different paths.
//
// LIVENESS — GET /api/health. Is this process up? No dependency checks. The ALB
// target group polls this, and its answer decides whether ECS keeps a task in
// service. A deep check here means a database blip marks every task unhealthy
// at once, ECS drains them all, and a dependency that might recover in seconds
// becomes a full outage — while the container was alive and able to serve
// cached and static responses throughout.
//
// READINESS — GET /api/health/ready. Are the dependencies reachable? The
// production deploy workflow calls this after the rollout, and CloudWatch
// alarms should watch it. It is what stops a release going green while the API
// cannot reach its database.
//
// CHANGED MEANING: /api/health ran the database indicator until 2026-08-17.
// Anything polling it for dependency status must move to /api/health/ready — a
// 200 here no longer says anything about Postgres.
//
// Both are version-neutral: the ECS probe and the deploy workflow target fixed
// paths and should not move with API versions.
//
// @NoEnvelope because these serve @nestjs/terminus's own shape, which
// api-reference.md documents and production already returns. Wrapping them in
// { success, data } would still pass the ALB check (it only reads the status
// code) while silently changing a published contract.
//
// @Public() because the ECS health probe carries no credentials. Without it
// the container fails its own health check, the service never reaches a steady
// state, and the deployment circuit breaker rolls back — with the application
// itself working perfectly.
@Public()
@NoEnvelope()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
  ) {}

  // Deliberately does not call HealthCheckService at all. Routing this through
  // terminus with an empty indicator list would work today and leave a place
  // for someone to add an indicator later, which is the exact mistake this
  // split exists to undo. Shaped like a terminus result so a client can parse
  // both endpoints with one shape.
  @Get()
  @Version(VERSION_NEUTRAL)
  live(): HealthCheckResult {
    return { status: 'ok', info: {}, error: {}, details: {} };
  }

  // Terminus answers 503 with the same shape when an indicator is down, which
  // is what the deploy workflow and any alarm key on. Redis joins the list here
  // when a cache module exists — not in `live` above.
  @Get('ready')
  @Version(VERSION_NEUTRAL)
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.prismaIndicator.isHealthy('database')]);
  }
}
