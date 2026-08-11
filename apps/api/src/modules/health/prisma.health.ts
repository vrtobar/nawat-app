import { prisma } from '@nahuat/database';
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';

// Terminus has no built-in Prisma indicator — this pings the DB with a
// trivial query so /api/health reflects real connectivity, which is what
// the ECS target group health check needs to gate deployments on.
@Injectable()
export class PrismaHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : 'unknown database error',
      });
    }
  }
}
