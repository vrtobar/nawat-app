import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { PrismaHealthIndicator } from './prisma.health';

// GET /api/health — version-neutral on purpose: the ECS health check
// probe targets a fixed path and shouldn't move with API versions.
//
// @NoEnvelope because this serves @nestjs/terminus's own shape, which
// api-reference.md documents and production already returns. Wrapping it in
// { success, data } would still pass the ALB check (it only reads the status
// code) while silently changing a published contract.
//
// TODO(PLAN §12): mark @Public() once the global JwtAuthGuard exists.
@NoEnvelope()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
  ) {}

  @Get()
  @Version(VERSION_NEUTRAL)
  @HealthCheck()
  check() {
    return this.health.check([() => this.prismaIndicator.isHealthy('database')]);
  }
}
