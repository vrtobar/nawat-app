import { prisma } from '@nahuat/database';
import { DialectSchema } from '@nahuat/shared';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DialectsService } from './dialects.service';

vi.mock('@nahuat/database', () => ({
  prisma: {
    dialect: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    translation: { count: vi.fn() },
  },
}));

const dialect = vi.mocked(prisma.dialect);
const translation = vi.mocked(prisma.translation);

// Prisma's return type for a select is an elaborate generic no hand-written
// fixture satisfies, so the mocks are cast to `never` on the way in — which
// means TypeScript checks nothing about the shape the service returns. Parsing
// each response through DialectSchema.strict() closes that hole exactly as the
// getProfile helper does in users.service.spec: a leaked internal field fails
// the same way a missing required one does. The schema is the single source of
// truth for the shape, so the assertion cannot drift from the contract.
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'dia_1',
  code: 'izalco',
  nameEs: 'Nawat de Izalco',
  nameEn: 'Izalco Nawat',
  descriptionEs: 'La variedad hablada en Izalco.',
  descriptionEn: 'The variety spoken in Izalco.',
  precedence: 20,
  ...overrides,
});

// A valid CreateDialect body — reused as the update body too, since every field
// is optional there.
const input = (overrides: Record<string, unknown> = {}) => ({
  code: 'izalco',
  nameEs: 'Nawat de Izalco',
  nameEn: 'Izalco Nawat',
  descriptionEs: 'La variedad hablada en Izalco.',
  descriptionEn: 'The variety spoken in Izalco.',
  ...overrides,
});

// A Prisma client error carries its code on `.code`; the service branches on
// it. Object.assign keeps it a real Error so `instanceof` and stacks behave.
const prismaError = (code: string) => Object.assign(new Error(`prisma ${code}`), { code });

// Rejects, and returns the API error code the exception carries so a test can
// assert the mapping in one line. Fails loudly if the call unexpectedly
// resolves — a silent resolve would otherwise pass as an empty code.
const errorCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    throw new Error('expected the call to reject, but it resolved');
  } catch (error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (response as { code?: string })?.code ?? '';
  }
};

describe('DialectsService', () => {
  const service = new DialectsService();

  beforeEach(() => vi.resetAllMocks());

  describe('list', () => {
    it('returns every dialect in the shared contract shape', async () => {
      dialect.findMany.mockResolvedValue([row(), row({ id: 'dia_2', code: 'common' })] as never);

      const result = await service.list();

      // Each row is the declared contract, not merely a superset of it.
      result.forEach((d) => DialectSchema.strict().parse(d));
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ code: 'izalco' });
    });
  });

  describe('create', () => {
    it('returns the created dialect in the contract shape', async () => {
      dialect.create.mockResolvedValue(row() as never);

      const created = await service.create(input());

      DialectSchema.strict().parse(created);
      expect(created).toMatchObject({ code: 'izalco', nameEn: 'Izalco Nawat' });
    });

    it('maps a unique-constraint violation to CONFLICT', async () => {
      // code, nameEs and nameEn are each unique; any collision arrives as P2002.
      dialect.create.mockRejectedValue(prismaError('P2002') as never);

      const promise = service.create(input());
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      expect(await errorCode(service.create(input()))).toBe('CONFLICT');
    });

    it('does not swallow an unexpected Prisma error', async () => {
      dialect.create.mockRejectedValue(prismaError('P1001') as never); // can't reach db

      await expect(service.create(input())).rejects.toMatchObject({ code: 'P1001' });
    });
  });

  describe('update', () => {
    it('returns the updated dialect in the contract shape', async () => {
      dialect.update.mockResolvedValue(row({ nameEn: 'Izalco variety' }) as never);

      const updated = await service.update('dia_1', input({ nameEn: 'Izalco variety' }));

      DialectSchema.strict().parse(updated);
      expect(updated).toMatchObject({ nameEn: 'Izalco variety' });
    });

    it('maps a missing row (P2025) to DIALECT_NOT_FOUND', async () => {
      dialect.update.mockRejectedValue(prismaError('P2025') as never);

      await expect(service.update('nope', input())).rejects.toBeInstanceOf(NotFoundException);
      expect(await errorCode(service.update('nope', input()))).toBe('DIALECT_NOT_FOUND');
    });

    it('maps a unique-constraint violation to CONFLICT', async () => {
      dialect.update.mockRejectedValue(prismaError('P2002') as never);

      expect(await errorCode(service.update('dia_1', input()))).toBe('CONFLICT');
    });
  });

  describe('delete', () => {
    it('deletes a dialect that no translation references', async () => {
      dialect.findUnique.mockResolvedValue({ code: 'izalco' } as never);
      translation.count.mockResolvedValue(0 as never);

      await service.delete('dia_1');

      expect(dialect.delete).toHaveBeenCalledWith({ where: { id: 'dia_1' } });
    });

    it('404s DIALECT_NOT_FOUND when the id matches no row', async () => {
      dialect.findUnique.mockResolvedValue(null as never);

      await expect(service.delete('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(await errorCode(service.delete('nope'))).toBe('DIALECT_NOT_FOUND');
      expect(dialect.delete).not.toHaveBeenCalled();
    });

    it('409s DIALECT_IN_USE and does not delete when translations reference it', async () => {
      dialect.findUnique.mockResolvedValue({ code: 'izalco' } as never);
      translation.count.mockResolvedValue(3 as never);

      const rejection = service.delete('dia_1');
      await expect(rejection).rejects.toBeInstanceOf(ConflictException);

      dialect.findUnique.mockResolvedValue({ code: 'izalco' } as never);
      translation.count.mockResolvedValue(3 as never);
      expect(await errorCode(service.delete('dia_1'))).toBe('DIALECT_IN_USE');
      expect(dialect.delete).not.toHaveBeenCalled();
    });
  });
});
