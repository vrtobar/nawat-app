import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { TransformInterceptor } from './transform.interceptor';

const run = async (returned: unknown, skip = false): Promise<unknown> => {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(skip) } as unknown as Reflector;
  const context = { getHandler: () => undefined, getClass: () => undefined };
  const next = { handle: () => of(returned) };

  return firstValueFrom(
    new TransformInterceptor(reflector).intercept(context as never, next as never),
  );
};

describe('TransformInterceptor', () => {
  it('wraps a single item', async () => {
    await expect(run({ id: 'ent_1', nawatContent: 'takat' })).resolves.toEqual({
      success: true,
      data: { id: 'ent_1', nawatContent: 'takat' },
    });
  });

  it('keeps a paginated result flat', async () => {
    // The failure this prevents is data.data — nesting the page inside the
    // envelope's data field, which breaks ApiPaginatedSchema.
    const meta = { total: 100, page: 1, limit: 20, totalPages: 5 };

    await expect(run({ data: [{ id: 'ent_1' }], meta })).resolves.toEqual({
      success: true,
      data: [{ id: 'ent_1' }],
      meta,
    });
  });

  it('does not flatten a domain object that merely has data and meta', async () => {
    // An Exercise carries a config blob; a future model could carry data/meta
    // of its own. Only a full PaginationMeta counts as a page.
    const value = { data: [1, 2], meta: { note: 'not pagination' } };

    await expect(run(value)).resolves.toEqual({ success: true, data: value });
  });

  it('does not flatten when meta is incomplete', async () => {
    const value = { data: [1], meta: { total: 1, page: 1 } };

    await expect(run(value)).resolves.toEqual({ success: true, data: value });
  });

  it('wraps an array that is not paginated', async () => {
    await expect(run([{ code: 'base' }])).resolves.toEqual({
      success: true,
      data: [{ code: 'base' }],
    });
  });

  it('turns undefined into null so data is always present', async () => {
    // {"success":true} with no data key fails ApiSuccessSchema.
    await expect(run(undefined)).resolves.toEqual({ success: true, data: null });
  });

  it('passes through untouched when @NoEnvelope is set', async () => {
    // GET /api/health serves terminus's shape to the ECS probe and is
    // documented unwrapped.
    const terminus = { status: 'ok', info: { database: { status: 'up' } } };

    await expect(run(terminus, true)).resolves.toEqual(terminus);
  });
});
