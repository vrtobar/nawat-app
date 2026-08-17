import { Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaHealthIndicator } from './prisma.health';

const queryRaw = vi.fn();

vi.mock('@nahuat/database', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
}));

describe('PrismaHealthIndicator', () => {
  const buildIndicator = async () => {
    const up = vi.fn().mockReturnValue({ database: { status: 'up' } });
    const down = vi.fn().mockImplementation((payload: unknown) => ({
      database: { status: 'down', ...(payload as object) },
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaHealthIndicator,
        { provide: HealthIndicatorService, useValue: { check: () => ({ up, down }) } },
      ],
    }).compile();

    return { indicator: moduleRef.get(PrismaHealthIndicator), up, down };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    queryRaw.mockReset();
  });

  it('reports up when the query succeeds', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const { indicator, up, down } = await buildIndicator();

    await indicator.isHealthy('database');

    expect(up).toHaveBeenCalledOnce();
    expect(down).not.toHaveBeenCalled();
  });

  // The endpoint this feeds is @Public(). A Prisma connection error names the
  // host, port and database, so returning it hands an unauthenticated caller a
  // map of the private subnet.
  it('does not leak the driver message to the caller', async () => {
    const detail =
      "Can't reach database server at nahuat-production.abc123.us-east-1.rds.amazonaws.com:5432";
    queryRaw.mockRejectedValue(new Error(detail));
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const { indicator, down } = await buildIndicator();
    const result = await indicator.isHealthy('database');

    expect(down).toHaveBeenCalledWith({ message: 'Database is unreachable' });
    expect(JSON.stringify(result)).not.toContain('rds.amazonaws.com');
    expect(JSON.stringify(result)).not.toContain('5432');

    // ...and the detail is still recoverable by someone reading the logs.
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]?.[0]).toContain(detail);
  });

  it('survives a rejection that is not an Error', async () => {
    queryRaw.mockRejectedValue('connection reset');
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const { indicator, down } = await buildIndicator();

    await expect(indicator.isHealthy('database')).resolves.toBeDefined();
    expect(down).toHaveBeenCalledWith({ message: 'Database is unreachable' });
  });
});
