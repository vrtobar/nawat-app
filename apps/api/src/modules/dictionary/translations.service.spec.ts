import { prisma } from '@nahuat/database';
import { TranslationDetailSchema } from '@nahuat/shared';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// The delete path selects isPublished plus a _count of the Restrict children.
const deleteRow = (isPublished: boolean, counts: Record<string, number> = {}) => ({
  isPublished,
  _count: {
    flashcards: 0,
    lessonVocabulary: 0,
    exerciseTranslations: 0,
    userCardProgress: 0,
    ...counts,
  },
});

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

// The version the caller claims to have loaded. Mocks do not enforce the
// WHERE, so its value is arbitrary — what the tests assert is that it REACHES
// the query, and that a zero-row result becomes a conflict.
const LOADED_AT = '2026-08-24T00:00:00.000Z';

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
    it('updates a draft translation (CONTRIBUTOR), re-stamping the editor', async () => {
      translation.findFirst
        .mockResolvedValueOnce({ isPublished: false } as never) // existence + gate check
        .mockResolvedValueOnce(detailRow() as never); // read-back
      translation.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await service.update(
        'tra_1',
        { contentEs: 'varón', expectedUpdatedAt: LOADED_AT },
        'usr_9',
        'CONTRIBUTOR',
        'es',
      );

      TranslationDetailSchema.strict().parse(result);
      expect(translation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // The lock reaches the WHERE, which is the whole mechanism: a row
          // whose updatedAt has moved matches nothing and is not overwritten.
          where: expect.objectContaining({
            id: 'tra_1',
            deletedAt: null,
            updatedAt: new Date(LOADED_AT),
          }),
          data: expect.objectContaining({ updaterId: 'usr_9' }),
        }),
      );
    });

    it('409s EDIT_CONFLICT when the row moved since the caller loaded it', async () => {
      // The path where a lost update hurts most: the editor sends every field,
      // not a diff, so an unconditional write here would push this caller's
      // stale blanks over whatever the other author had just saved.
      translation.findFirst
        .mockResolvedValueOnce({ isPublished: false } as never) // gate check
        .mockResolvedValueOnce({ id: 'tra_1' } as never); // still there?
      translation.updateMany.mockResolvedValue({ count: 0 } as never);

      const rejection = service.update(
        'tra_1',
        { contentEs: 'x', expectedUpdatedAt: LOADED_AT },
        'usr_9',
        'CONTRIBUTOR',
        'es',
      );

      await expect(rejection).rejects.toBeInstanceOf(ConflictException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'EDIT_CONFLICT' });
      });
    });

    it('404s instead when the row was removed rather than edited', async () => {
      translation.findFirst
        .mockResolvedValueOnce({ isPublished: false } as never)
        .mockResolvedValueOnce(null as never);
      translation.updateMany.mockResolvedValue({ count: 0 } as never);

      const rejection = service.update(
        'tra_1',
        { contentEs: 'x', expectedUpdatedAt: LOADED_AT },
        'usr_9',
        'CONTRIBUTOR',
        'es',
      );

      await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'TRANSLATION_NOT_FOUND' });
      });
    });

    it("scopes a CONTRIBUTOR through the parent entry's creator", async () => {
      // Scoped by the ENTRY's creator rather than the translation's, so what a
      // contributor may write matches exactly what GET /admin/entries shows
      // them.
      translation.findFirst.mockResolvedValueOnce(null as never);

      const rejection = service.update(
        'tra_1',
        { contentEs: 'x', expectedUpdatedAt: LOADED_AT },
        'usr_1',
        'CONTRIBUTOR',
        'es',
      );
      await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'TRANSLATION_NOT_FOUND' });
      });

      expect(translation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tra_1', deletedAt: null, entry: { creatorId: 'usr_1' } },
        }),
      );
      expect(translation.updateMany).not.toHaveBeenCalled();
    });

    it('applies no ownership predicate for an ADMIN', async () => {
      translation.findFirst
        .mockResolvedValueOnce({ isPublished: false } as never)
        .mockResolvedValueOnce(detailRow() as never);
      translation.updateMany.mockResolvedValue({ count: 1 } as never);

      await service.update(
        'tra_1',
        { contentEs: 'x', expectedUpdatedAt: LOADED_AT },
        'adm_1',
        'ADMIN',
        'es',
      );

      expect(translation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tra_1', deletedAt: null } }),
      );
    });

    it('refuses a CONTRIBUTOR editing a published translation (FORBIDDEN), without writing', async () => {
      translation.findFirst.mockResolvedValueOnce({ isPublished: true } as never);

      const rejection = service.update(
        'tra_1',
        { contentEs: 'x', expectedUpdatedAt: LOADED_AT },
        'usr_1',
        'CONTRIBUTOR',
        'es',
      );
      await expect(rejection).rejects.toBeInstanceOf(ForbiddenException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'FORBIDDEN' });
      });
      expect(translation.updateMany).not.toHaveBeenCalled();
    });

    it('lets an ADMIN edit a published translation', async () => {
      translation.findFirst
        .mockResolvedValueOnce({ isPublished: true } as never)
        .mockResolvedValueOnce(detailRow() as never);
      translation.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await service.update(
        'tra_1',
        { contentEs: 'x', expectedUpdatedAt: LOADED_AT },
        'adm_1',
        'ADMIN',
        'es',
      );

      TranslationDetailSchema.strict().parse(result);
      expect(translation.updateMany).toHaveBeenCalled();
    });

    it('404s TRANSLATION_NOT_FOUND when no live row matches, without writing', async () => {
      translation.findFirst.mockResolvedValueOnce(null as never);

      const rejection = service.update(
        'nope',
        { phonetic: 'x', expectedUpdatedAt: LOADED_AT },
        'usr_1',
        'CONTRIBUTOR',
        'es',
      );
      await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'TRANSLATION_NOT_FOUND' });
      });
      expect(translation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('soft-deletes a published translation with no references', async () => {
      translation.findFirst.mockResolvedValue(deleteRow(true) as never);

      await service.delete('tra_1', 'usr_1');

      expect(translation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tra_1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date), updaterId: 'usr_1' }),
        }),
      );
      expect(translation.delete).not.toHaveBeenCalled();
    });

    it('hard-deletes a draft translation with no references', async () => {
      translation.findFirst.mockResolvedValue(deleteRow(false) as never);

      await service.delete('tra_1', 'usr_1');

      expect(translation.delete).toHaveBeenCalledWith({ where: { id: 'tra_1' } });
      expect(translation.update).not.toHaveBeenCalled();
    });

    it('409s TRANSLATION_IN_USE and removes nothing when a reference exists', async () => {
      translation.findFirst.mockResolvedValue(
        deleteRow(true, { exerciseTranslations: 2 }) as never,
      );

      const rejection = service.delete('tra_1', 'usr_1');
      await expect(rejection).rejects.toBeInstanceOf(ConflictException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'TRANSLATION_IN_USE' });
      });
      expect(translation.update).not.toHaveBeenCalled();
      expect(translation.delete).not.toHaveBeenCalled();
    });

    it('404s TRANSLATION_NOT_FOUND when no live row matches', async () => {
      translation.findFirst.mockResolvedValue(null as never);

      const rejection = service.delete('nope', 'usr_1');
      await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'TRANSLATION_NOT_FOUND' });
      });
    });
  });
});
