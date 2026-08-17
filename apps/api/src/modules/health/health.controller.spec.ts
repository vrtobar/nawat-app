import { HealthCheckService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';

// This is as much a check on the test setup as on the controller: NestJS
// resolves these constructor parameters from decorator metadata, which Vitest
// only emits because of the swc plugin in vitest.config.ts. If that plugin is
// removed, this test fails with "Nest can't resolve dependencies".
describe('HealthController', () => {
  const buildController = async (indicatorResult: unknown) => {
    const healthCheck = vi.fn().mockResolvedValue(indicatorResult);
    const isHealthy = vi.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check: healthCheck } },
        { provide: PrismaHealthIndicator, useValue: { isHealthy } },
      ],
    }).compile();

    return { controller: moduleRef.get(HealthController), healthCheck, isHealthy };
  };

  describe('liveness', () => {
    it('reports ok', async () => {
      const { controller } = await buildController({ status: 'ok' });

      expect(controller.live()).toMatchObject({ status: 'ok' });
    });

    // The property the whole split exists for. If liveness ever consults a
    // dependency, one database blip marks every task unhealthy and ECS drains
    // the entire service — so this asserts the absence of a call, not a value.
    it('consults no dependency', async () => {
      const { controller, healthCheck, isHealthy } = await buildController({ status: 'ok' });

      controller.live();

      expect(healthCheck).not.toHaveBeenCalled();
      expect(isHealthy).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('reports the database indicator when it is up', async () => {
      const { controller } = await buildController({
        status: 'ok',
        info: { database: { status: 'up' } },
      });

      await expect(controller.ready()).resolves.toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' } },
      });
    });

    it('delegates to the terminus health check rather than querying directly', async () => {
      const { controller, healthCheck } = await buildController({ status: 'ok' });

      await controller.ready();

      expect(healthCheck).toHaveBeenCalledOnce();
      expect(healthCheck.mock.calls[0]?.[0]).toHaveLength(1);
    });
  });
});
