import { prisma } from '@nahuat/database';
import { DictionaryEntryDetailSchema, DictionaryEntryListItemSchema } from '@nahuat/shared';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntriesService } from './entries.service';

vi.mock('@nahuat/database', () => ({
  // The service uses the Prisma namespace for where-input types (erased at
  // runtime) and for `Prisma.sql`/`Prisma.empty` when composing the raw search
  // query (present at runtime). $queryRaw is mocked to ignore its argument, so
  // the SQL fragments only need to exist, not be real — these tests assert the
  // mapping of the returned rows, not the SQL, which needs a live Postgres.
  Prisma: {
    sql: () => ({}),
    empty: {},
  },
  prisma: {
    entry: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

const entry = vi.mocked(prisma.entry);
const queryRaw = vi.mocked(prisma.$queryRaw);

// As in users/dialects specs: the Prisma mock is cast to `never`, so TypeScript
// checks nothing about the row shapes fed in or the response shape out. Parsing
// every response through the shared schema's .strict() is what makes the
// resolution and mapping real — a leaked field, a Date left unserialised, or a
// primary picked from the wrong dialect fails the parse rather than passing a
// looser toMatchObject.
const translation = (overrides: Record<string, unknown> = {}) => ({
  id: 'tra_1',
  dialectCode: 'common',
  priority: 1,
  partOfSpeech: 'NOUN',
  phonetic: 'ˈta.kat',
  audioUrl: null,
  contentEs: 'hombre',
  contentEn: 'man',
  ...overrides,
});

const entryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ent_1',
  type: 'WORD',
  nawatContent: 'takat',
  imageUrl: null,
  isPublished: true,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  translations: [translation()],
  ...overrides,
});

// Detail rows carry the fuller translation shape plus the inline dialect.
const detailTranslation = (overrides: Record<string, unknown> = {}) => ({
  id: 'tra_1',
  contentEs: 'hombre',
  contentEn: 'man',
  exampleNawat: 'ne takat',
  exampleEs: 'el hombre',
  exampleEn: 'the man',
  phonetic: 'ˈta.kat',
  partOfSpeech: 'NOUN',
  audioUrl: null,
  priority: 1,
  isPublished: true,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-02T09:00:00.000Z'),
  dialect: {
    id: 'dia_1',
    code: 'common',
    nameEs: 'Nawat común',
    nameEn: 'Common Nawat',
    descriptionEs: 'La forma de uso amplio.',
    descriptionEn: 'The broadly used form.',
  },
  ...overrides,
});

const detailRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ent_1',
  type: 'WORD',
  nawatContent: 'takat',
  imageUrl: null,
  isPublished: true,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-02T09:00:00.000Z'),
  creator: { name: 'Victor' },
  translations: [detailTranslation()],
  ...overrides,
});

describe('EntriesService', () => {
  const service = new EntriesService();

  beforeEach(() => vi.resetAllMocks());

  describe('browse', () => {
    it('returns list items in the contract shape with resolved Spanish content', async () => {
      entry.count.mockResolvedValue(1 as never);
      entry.findMany.mockResolvedValue([entryRow()] as never);

      const result = await service.browse({ page: 1, limit: 20 }, 'es');

      result.data.forEach((item) => DictionaryEntryListItemSchema.strict().parse(item));
      expect(result.data[0]).toMatchObject({
        primaryTranslation: { content: 'hombre', locale: 'es', dialectCode: 'common' },
      });
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('resolves English content and derives totalPages from the count', async () => {
      entry.count.mockResolvedValue(45 as never);
      entry.findMany.mockResolvedValue([entryRow()] as never);

      const result = await service.browse({ page: 2, limit: 20 }, 'en');

      expect(result.data[0]).toMatchObject({
        primaryTranslation: { content: 'man', locale: 'en' },
      });
      // Page 2 of 45 at 20/page → 3 pages, offset 20.
      expect(result.meta).toEqual({ total: 45, page: 2, limit: 20, totalPages: 3 });
      expect(entry.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
    });

    it('prefers the common form over a lower-priority dialect', async () => {
      // Pre-ordered by (priority, dialect) as the query returns them: an Izalco
      // form at priority 1 sits before the common form at priority 2. The common
      // one must still win — it is the headword whatever its priority.
      entry.count.mockResolvedValue(1 as never);
      entry.findMany.mockResolvedValue([
        entryRow({
          translations: [
            translation({ id: 'tra_iz', dialectCode: 'izalco', priority: 1 }),
            translation({ id: 'tra_co', dialectCode: 'common', priority: 2 }),
          ],
        }),
      ] as never);

      const result = await service.browse({ page: 1, limit: 20 }, 'es');

      expect(result.data[0]).toMatchObject({
        primaryTranslation: { id: 'tra_co', dialectCode: 'common' },
      });
    });

    it('falls back to the lowest-priority dialect when no common form exists', async () => {
      // A town-only word: no common translation, so the first (lowest-priority)
      // candidate becomes the primary rather than the entry being dropped.
      entry.count.mockResolvedValue(1 as never);
      entry.findMany.mockResolvedValue([
        entryRow({
          translations: [
            translation({
              id: 'tra_iz',
              dialectCode: 'izalco',
              priority: 1,
              contentEs: 'takat izalco',
            }),
            translation({ id: 'tra_sd', dialectCode: 'santo-domingo', priority: 2 }),
          ],
        }),
      ] as never);

      const result = await service.browse({ page: 1, limit: 20 }, 'es');

      expect(result.data[0]).toMatchObject({
        primaryTranslation: { id: 'tra_iz', dialectCode: 'izalco', content: 'takat izalco' },
      });
    });

    it('requires English content in the query when the locale is English', async () => {
      entry.count.mockResolvedValue(0 as never);
      entry.findMany.mockResolvedValue([] as never);

      await service.browse({ page: 1, limit: 20 }, 'en');

      // The renderable filter must exclude translations without an English form;
      // for Spanish it must not, since contentEs is mandatory.
      expect(entry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            translations: { some: expect.objectContaining({ contentEn: { not: null } }) },
          }),
        }),
      );
    });

    it('narrows visibility and the primary pick by dialect and part of speech', async () => {
      entry.count.mockResolvedValue(0 as never);
      entry.findMany.mockResolvedValue([] as never);

      await service.browse(
        { page: 1, limit: 20, dialectCode: 'izalco', partOfSpeech: 'VERB', type: 'WORD' },
        'es',
      );

      expect(entry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'WORD',
            translations: {
              some: expect.objectContaining({ dialectCode: 'izalco', partOfSpeech: 'VERB' }),
            },
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns the entry detail in the contract shape', async () => {
      entry.findFirst.mockResolvedValue(detailRow() as never);

      const result = await service.findById('ent_1', 'es');

      DictionaryEntryDetailSchema.strict().parse(result);
      expect(result).toMatchObject({
        nawatContent: 'takat',
        creator: { name: 'Victor' },
      });
      expect(result.translations[0]).toMatchObject({
        content: 'hombre',
        example: 'el hombre',
        exampleNawat: 'ne takat',
        locale: 'es',
      });
    });

    it('resolves each translation to English, example included', async () => {
      entry.findFirst.mockResolvedValue(detailRow() as never);

      const result = await service.findById('ent_1', 'en');

      expect(result.translations[0]).toMatchObject({
        content: 'man',
        example: 'the man',
        locale: 'en',
      });
    });

    it('keeps a missing example null', async () => {
      entry.findFirst.mockResolvedValue(
        detailRow({ translations: [detailTranslation({ exampleEs: null })] }) as never,
      );

      const result = await service.findById('ent_1', 'es');

      expect(result.translations[0]?.example).toBeNull();
    });

    it('404s ENTRY_NOT_FOUND when nothing live matches the id', async () => {
      entry.findFirst.mockResolvedValue(null as never);

      const rejection = service.findById('nope', 'es');
      await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'ENTRY_NOT_FOUND' });
      });
    });
  });

  // $queryRaw is called twice, in Promise.all order: [0] ranks the ids, [1]
  // counts distinct matches. entry.findMany then hydrates. The SQL itself
  // (accent folding, similarity threshold, index use) is beyond a unit test and
  // needs a live Postgres; these cover the ordering, hydration and meta.
  describe('search', () => {
    it('hydrates in the ranking order, not alphabetically, in the contract shape', async () => {
      queryRaw
        .mockResolvedValueOnce([{ id: 'ent_b' }, { id: 'ent_a' }] as never)
        .mockResolvedValueOnce([{ count: 2n }] as never);
      // Returned in the opposite (alphabetical) order to prove the re-sort back
      // to the ranking rather than to whatever order the IN clause yields.
      entry.findMany.mockResolvedValue([
        entryRow({ id: 'ent_a', nawatContent: 'aaa' }),
        entryRow({ id: 'ent_b', nawatContent: 'bbb' }),
      ] as never);

      const result = await service.search({ q: 'takat', page: 1, limit: 20 }, 'es');

      result.data.forEach((item) => DictionaryEntryListItemSchema.strict().parse(item));
      expect(result.data.map((d) => d.id)).toEqual(['ent_b', 'ent_a']);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('resolves each hydrated row to the requested locale', async () => {
      queryRaw
        .mockResolvedValueOnce([{ id: 'ent_1' }] as never)
        .mockResolvedValueOnce([{ count: 1n }] as never);
      entry.findMany.mockResolvedValue([entryRow()] as never);

      const result = await service.search({ q: 'man', page: 1, limit: 20 }, 'en');

      expect(result.data[0]).toMatchObject({
        primaryTranslation: { content: 'man', locale: 'en' },
      });
    });

    it('returns empty data with zeroed meta and skips hydration on no match', async () => {
      queryRaw.mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ count: 0n }] as never);

      const result = await service.search({ q: 'zzz', page: 1, limit: 20 }, 'es');

      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
      // No ids to hydrate — the second round trip must not run.
      expect(entry.findMany).not.toHaveBeenCalled();
    });

    it('derives totalPages from the distinct match count', async () => {
      queryRaw
        .mockResolvedValueOnce([{ id: 'ent_1' }] as never)
        .mockResolvedValueOnce([{ count: 45n }] as never);
      entry.findMany.mockResolvedValue([entryRow()] as never);

      const result = await service.search({ q: 'takat', page: 2, limit: 20 }, 'es');

      // 45 matches at 20/page → 3 pages.
      expect(result.meta).toEqual({ total: 45, page: 2, limit: 20, totalPages: 3 });
    });
  });

  describe('create', () => {
    it('creates a draft and returns it in the detail shape', async () => {
      entry.create.mockResolvedValue(detailRow({ isPublished: false, translations: [] }) as never);

      const result = await service.create({ nawatContent: 'takat', type: 'WORD' }, 'usr_1', 'es');

      DictionaryEntryDetailSchema.strict().parse(result);
      expect(result).toMatchObject({ nawatContent: 'takat', isPublished: false, translations: [] });
    });

    it('stamps attribution from the caller, not the body', async () => {
      entry.create.mockResolvedValue(detailRow({ isPublished: false, translations: [] }) as never);

      await service.create({ nawatContent: 'takat', type: 'WORD' }, 'usr_1', 'es');

      // creatorId and updaterId come from the token argument; the body has no
      // say in who a row is attributed to.
      expect(entry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ creatorId: 'usr_1', updaterId: 'usr_1' }),
        }),
      );
    });

    it('maps a duplicate nawatContent to CONFLICT', async () => {
      entry.create.mockRejectedValue({ code: 'P2002' } as never);

      const rejection = service.create({ nawatContent: 'takat', type: 'WORD' }, 'usr_1', 'es');
      await expect(rejection).rejects.toBeInstanceOf(ConflictException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'CONFLICT' });
      });
    });
  });

  describe('update', () => {
    it('updates a live entry and returns the detail shape', async () => {
      entry.updateMany.mockResolvedValue({ count: 1 } as never);
      entry.findFirst.mockResolvedValue(detailRow() as never);

      const result = await service.update('ent_1', { nawatContent: 'tak+' }, 'usr_1', 'es');

      DictionaryEntryDetailSchema.strict().parse(result);
      expect(result).toMatchObject({ creator: { name: 'Victor' } });
    });

    it('re-stamps updaterId and guards on deletedAt', async () => {
      entry.updateMany.mockResolvedValue({ count: 1 } as never);
      entry.findFirst.mockResolvedValue(detailRow() as never);

      await service.update('ent_1', { nawatContent: 'x' }, 'usr_9', 'es');

      expect(entry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ent_1', deletedAt: null },
          data: expect.objectContaining({ updaterId: 'usr_9' }),
        }),
      );
    });

    it('404s ENTRY_NOT_FOUND when no live row matches, without reading back', async () => {
      entry.updateMany.mockResolvedValue({ count: 0 } as never);

      const rejection = service.update('nope', { nawatContent: 'x' }, 'usr_1', 'es');
      await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
      await rejection.catch((error: { getResponse(): { code: string } }) => {
        expect(error.getResponse()).toMatchObject({ code: 'ENTRY_NOT_FOUND' });
      });
      expect(entry.findFirst).not.toHaveBeenCalled();
    });

    it('maps a duplicate nawatContent to CONFLICT', async () => {
      entry.updateMany.mockRejectedValue({ code: 'P2002' } as never);

      const rejection = service.update('ent_1', { nawatContent: 'dupe' }, 'usr_1', 'es');
      await expect(rejection).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
