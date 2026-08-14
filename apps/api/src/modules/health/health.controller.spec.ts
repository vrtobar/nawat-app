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

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check: healthCheck } },
        { provide: PrismaHealthIndicator, useValue: { isHealthy: vi.fn() } },
      ],
    }).compile();

    return { controller: moduleRef.get(HealthController), healthCheck };
  };

  it('reports the database indicator when it is up', async () => {
    const { controller } = await buildController({
      status: 'ok',
      info: { database: { status: 'up' } },
    });

    await expect(controller.check()).resolves.toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
    });
  });

  it('delegates to the terminus health check rather than querying directly', async () => {
    const { controller, healthCheck } = await buildController({ status: 'ok' });

    await controller.check();

    expect(healthCheck).toHaveBeenCalledOnce();
    expect(healthCheck.mock.calls[0]?.[0]).toHaveLength(1);
  });
});
