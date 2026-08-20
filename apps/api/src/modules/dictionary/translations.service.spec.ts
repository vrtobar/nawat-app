import { prisma } from '@nahuat/database';
import { TranslationDetailSchema } from '@nahuat/shared';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TranslationsService } from './translations.service';

vi.mock('@nahuat/database', () => ({
  // Prisma is only referenced for erased where-input/select types; the service
  // needs the client alone. Responses are parsed through TranslationDetailSchema
  // .strict() so the select-to-contract mapping is real — a leaked field or an
  // unserialised Date fails the parse rather than an ignored toMatchObject key.
  Prisma: {},
  prisma: {
    entry: { findFirst: vi.fn() },
    translation: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

const entry = vi.mocked(prisma.entry);
const translation = vi.mocked(prisma.translation);

// A row shaped like TRANSLATION_DETAIL_SELECT — the projection toTranslationDetail
// maps. Dates are real Date objects; the schema declares ISO strings, so a
// mapping that forgets to serialise them fails the strict parse.
const detailRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'tra_1',
  contentEs: 'hombre | persona',
  contentEn: 'man | person',
  exampleNawat: 'ne takat',
  exampleEs: 'el hombre',
  exampleEn: 'the man',
  phonetic: 'ˈta.kat',
  partOfSpeech: 'NOUN',
  audioUrl: null,
  isPublished: false,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-02T09:00:00.000Z'),
  dialect: {
    id: 'dia_1',
    code: 'common',
    nameEs: 'Nawat común',
    nameEn: 'Common Nawat',
    descriptionEs: 'La forma de uso amplio.',
    descriptionEn: 'The broadly used form.',
    precedence: 0,
  },
  ...overrides,
});

const input = (overrides: Record<string, unknown> = {}) => ({
  dialectCode: 'common',
  contentEs: 'hombre | persona',
  contentEn: 'man | person',
  ...overrides,
});

describe('TranslationsService', () => {
  const service = new TranslationsService();

  beforeEach(() => vi.resetAllMocks());

  describe('create', () => {
    it('creates the translation and returns the detail shape', async () => {
      entry.findFirst.mockResolvedValue({ id: 'ent_1' } as never);
      translation.create.mockResolvedValue(detailRow() as never);

      const result = await service.create('ent_1', input(), 'usr_1', 'es');

      TranslationDetailSchema.strict().parse(result);
      expect(translation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entryId: 'ent_1' }) }),
      );
    });

    it('stamps attribution from the caller, not the body', async () => {
      entry.findFirst.mockResolvedValue({ id: 'ent_1' } as never);
      translation.create.mockResolvedValue(detailRow() as never);

      await service.create('ent_1', input(), 'usr_9', 'es');

      expect(translation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ creatorId: 'usr_9', updaterId: 'usr_9' }),
        }),
      );
    });

    it('404s ENTRY_NOT_FOUND when the parent entry is missing or deleted', async () => {
      entry.findFirst.mockResolvedValue(null as never);

      const rejection = service.create('nope', input(), 'usr_1', 'es');
      await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'ENTRY_NOT_FOUND' });
      });
      expect(translation.create).not.toHaveBeenCalled();
    });

    it('maps an unknown dialect (FK failure) to DIALECT_NOT_FOUND', async () => {
      entry.findFirst.mockResolvedValue({ id: 'ent_1' } as never);
      translation.create.mockRejectedValue({ code: 'P2003' } as never);

      const rejection = service.create('ent_1', input({ dialectCode: 'nope' }), 'usr_1', 'es');
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'DIALECT_NOT_FOUND' });
      });
    });

    it('maps a second translation for the same dialect to CONFLICT', async () => {
      entry.findFirst.mockResolvedValue({ id: 'ent_1' } as never);
      translation.create.mockRejectedValue({ code: 'P2002' } as never);

      const rejection = service.create('ent_1', input(), 'usr_1', 'es');
      await expect(rejection).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('updates a live translation and returns the detail shape', async () => {
      translation.updateMany.mockResolvedValue({ count: 1 } as never);
      translation.findFirst.mockResolvedValue(detailRow() as never);

      const result = await service.update('tra_1', { contentEs: 'varón' }, 'usr_1', 'es');

      TranslationDetailSchema.strict().parse(result);
      expect(result).toMatchObject({ id: 'tra_1', locale: 'es' });
    });

    it('re-stamps updaterId and guards on deletedAt', async () => {
      translation.updateMany.mockResolvedValue({ count: 1 } as never);
      translation.findFirst.mockResolvedValue(detailRow() as never);

      await service.update('tra_1', { phonetic: 'x' }, 'usr_9', 'es');

      expect(translation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tra_1', deletedAt: null },
          data: expect.objectContaining({ updaterId: 'usr_9' }),
        }),
      );
    });

    it('404s TRANSLATION_NOT_FOUND when no live row matches, without reading back', async () => {
      translation.updateMany.mockResolvedValue({ count: 0 } as never);

      const rejection = service.update('nope', { phonetic: 'x' }, 'usr_1', 'es');
      await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'TRANSLATION_NOT_FOUND' });
      });
      expect(translation.findFirst).not.toHaveBeenCalled();
    });
  });
});
