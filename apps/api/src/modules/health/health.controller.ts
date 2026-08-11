import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { PrismaHealthIndicator } from './prisma.health';

// GET /api/health — version-neutral on purpose: the ECS health check
// probe targets a fixed path and shouldn't move with API versions.
// TODO(PLAN §12): mark @Public() once the global JwtAuthGuard exists.
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
