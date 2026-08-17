import { prisma } from '@nahuat/database';
import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';

// Terminus has no built-in Prisma indicator — this pings the database with a
// trivial query so /api/health/ready reflects real connectivity, which is what
// the production deploy workflow gates on.
@Injectable()
export class PrismaHealthIndicator {
  private readonly logger = new Logger(PrismaHealthIndicator.name);

  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (error) {
      // The driver's message is logged, never returned. /api/health/ready is
      // @Public(), and a Postgres connection failure names the host, port and
      // database — "Can't reach database server at nahuat-production-...:5432".
      // That is free reconnaissance for an unauthenticated caller, and the
      // detail only helps someone who can already read the logs.
      this.logger.error(
        `Database health check failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );

      return indicator.down({ message: 'Database is unreachable' });
    }
  }
}
