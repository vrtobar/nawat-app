import { prisma } from '@nahuat/database';
import {
  AdminEntriesQuerySchema,
  AdminEntryDetailSchema,
  AdminEntryListItemSchema,
  type JwtClaims,
} from '@nahuat/shared';
import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminEntriesService } from './admin-entries.service';

vi.mock('@nahuat/database', () => ({
  Prisma: {},
  prisma: {
    entry: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    // list() wraps findMany + count in a transaction. The array form resolves
    // the promises it is handed, so the mock mirrors that rather than replaying
    // a recorded result — otherwise the where clause under test never runs.
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const entry = vi.mocked(prisma.entry);

const admin: JwtClaims = { sub: 'auth0|a', role: 'ADMIN', userId: 'usr_admin', locale: 'es' };
const contributor: JwtClaims = {
  sub: 'auth0|c',
  role: 'CONTRIBUTOR',
  userId: 'usr_contrib',
  locale: 'es',
};

// Same reason as dialects.service.spec: Prisma mocks are cast to `never`, so
// TypeScript checks nothing about the returned shape. Parsing every response
// through the schema .strict() closes that — a leaked internal field fails as
// loudly as a missing required one, and the schema stays the source of truth.
const actor = { id: 'usr_admin', name: 'Dev User (ADMIN)' };

const listRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ent_1',
  type: 'WORD',
  nawatContent: 'takat',
  slug: 'takat',
  imageUrl: null,
  isPublished: false,
  createdAt: new Date('2026-08-24T00:00:00Z'),
  updatedAt: new Date('2026-08-24T00:00:00Z'),
  creator: actor,
  updater: actor,
  translations: [{ contentEn: 'man', isPublished: true }],
  ...overrides,
});

const detailRow = (overrides: Record<string, unknown> = {}) => ({
  ...listRow(),
  translations: [
    {
      id: 'tr_1',
      contentEs: 'hombre',
      contentEn: 'man',
      exampleNawat: 'Ne takat.',
      exampleEs: 'El hombre.',
      exampleEn: 'The man.',
      phonetic: '[ˈtakat]',
      partOfSpeech: 'NOUN',
      audioUrl: null,
      isPublished: false,
      dialect: {
        id: 'dia_1',
        code: 'common',
        nameEs: 'Nawat común',
        nameEn: 'Common Nawat',
        descriptionEs: 'Formas de uso amplio.',
        descriptionEn: 'Forms in broad use.',
        precedence: 0,
      },
      createdAt: new Date('2026-08-24T00:00:00Z'),
      updatedAt: new Date('2026-08-24T00:00:00Z'),
    },
  ],
  ...overrides,
});

// The where clause findMany was called with — the thing most of these tests
// assert on, since the scoping IS the security boundary.
const whereOf = () => vi.mocked(entry.findMany).mock.calls[0]?.[0]?.where;

const query = (overrides: Record<string, unknown> = {}) =>
  AdminEntriesQuerySchema.parse({ ...overrides });

describe('AdminEntriesService', () => {
  let service: AdminEntriesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdminEntriesService();
    entry.findMany.mockResolvedValue([listRow()] as never);
    entry.count.mockResolvedValue(1 as never);
    entry.findFirst.mockResolvedValue(detailRow() as never);
  });

  describe('scoping — the authorization boundary', () => {
    it('restricts a CONTRIBUTOR to rows they created', async () => {
      await service.list(query(), contributor);
      expect(whereOf()).toMatchObject({ creatorId: 'usr_contrib' });
    });

    it('does not restrict an ADMIN by creator', async () => {
      await service.list(query(), admin);
      expect(whereOf()).not.toHaveProperty('creatorId');
    });

    // The predicate negates against ADMIN rather than matching CONTRIBUTOR, so
    // a rank added between them is scoped to its own rows rather than silently
    // granted every author's. This test is the reason for that shape.
    it('scopes an unrecognised role to its own rows rather than opening up', async () => {
      const future = { ...contributor, role: 'REVIEWER' } as unknown as JwtClaims;
      await service.list(query(), future);
      expect(whereOf()).toMatchObject({ creatorId: 'usr_contrib' });
    });

    it('reapplies the scope on detail, so an id cannot be used to read another author', async () => {
      await service.detail('ent_1', contributor);
      expect(vi.mocked(entry.findFirst).mock.calls[0]?.[0]?.where).toMatchObject({
        id: 'ent_1',
        creatorId: 'usr_contrib',
      });
    });

    // 404 not 403: the two must be indistinguishable or the endpoint becomes an
    // oracle for whether an id exists.
    it('throws ENTRY_NOT_FOUND when the row is missing or not the caller’s', async () => {
      entry.findFirst.mockResolvedValue(null as never);
      await expect(service.detail('ent_x', contributor)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('status filter', () => {
    it('defaults to drafts only', async () => {
      await service.list(query(), admin);
      expect(whereOf()).toMatchObject({ isPublished: false, deletedAt: null });
    });

    it('filters to published when asked', async () => {
      await service.list(query({ status: 'published' }), admin);
      expect(whereOf()).toMatchObject({ isPublished: true });
    });

    // 'all' must add no isPublished predicate at all — an `undefined` value
    // would be equivalent here, but asserting absence keeps the where clause
    // matching entries_drafts_idx's predicate exactly for the default case.
    it('adds no publish predicate for status=all', async () => {
      await service.list(query({ status: 'all' }), admin);
      expect(whereOf()).not.toHaveProperty('isPublished');
      expect(whereOf()).toMatchObject({ deletedAt: null });
    });

    it('always excludes soft-deleted rows', async () => {
      for (const status of ['draft', 'published', 'all'] as const) {
        vi.clearAllMocks();
        entry.findMany.mockResolvedValue([] as never);
        entry.count.mockResolvedValue(0 as never);
        await service.list(query({ status }), admin);
        expect(whereOf()).toMatchObject({ deletedAt: null });
      }
    });
  });

  describe('search and ordering', () => {
    it('matches nawatContent as a case-insensitive substring, not a trigram', async () => {
      await service.list(query({ q: 'tak' }), admin);
      expect(whereOf()).toMatchObject({
        nawatContent: { contains: 'tak', mode: 'insensitive' },
      });
    });

    it('orders by updatedAt desc, matching entries_drafts_idx', async () => {
      await service.list(query(), admin);
      expect(vi.mocked(entry.findMany).mock.calls[0]?.[0]?.orderBy).toEqual({ updatedAt: 'desc' });
    });

    it('paginates from page and limit', async () => {
      entry.count.mockResolvedValue(45 as never);
      const result = await service.list(query({ page: 3, limit: 20 }), admin);
      expect(vi.mocked(entry.findMany).mock.calls[0]?.[0]).toMatchObject({ skip: 40, take: 20 });
      expect(result.meta).toEqual({ total: 45, page: 3, limit: 20, totalPages: 3 });
    });
  });

  describe("status 'pending-translations'", () => {
    it('asks for live entries holding a translation that is not live', async () => {
      entry.findMany.mockResolvedValue([] as never);
      entry.count.mockResolvedValue(0 as never);

      await service.list(query({ status: 'pending-translations' }), admin);

      // Both halves matter. Without isPublished it would also return every
      // draft entry, since none of their translations are published either —
      // which is the queue this view exists to be separate from.
      expect(vi.mocked(entry.findMany).mock.calls[0]?.[0]).toMatchObject({
        where: expect.objectContaining({
          isPublished: true,
          translations: { some: { isPublished: false, deletedAt: null } },
        }),
      });
    });

    it('still scopes a CONTRIBUTOR to their own entries', async () => {
      entry.findMany.mockResolvedValue([] as never);
      entry.count.mockResolvedValue(0 as never);

      await service.list(query({ status: 'pending-translations' }), contributor);

      expect(vi.mocked(entry.findMany).mock.calls[0]?.[0]).toMatchObject({
        where: expect.objectContaining({ creatorId: contributor.userId }),
      });
    });
  });

  describe('unpublishedTranslationCount', () => {
    it('counts a dialect added after the entry went live', async () => {
      // The state the list could not previously show: the entry is public, one
      // of its translations is not, and the public reads exclude that
      // translation in every locale.
      entry.findMany.mockResolvedValue([
        listRow({
          isPublished: true,
          translations: [
            { contentEn: 'man', isPublished: true },
            { contentEn: null, isPublished: false },
          ],
        }),
      ] as never);

      const { data } = await service.list(query(), admin);

      expect(data[0]).toMatchObject({
        isPublished: true,
        translationCount: 2,
        unpublishedTranslationCount: 1,
      });
    });

    it('is zero when every translation is published', async () => {
      entry.findMany.mockResolvedValue([
        listRow({
          isPublished: true,
          translations: [{ contentEn: 'man', isPublished: true }],
        }),
      ] as never);

      const { data } = await service.list(query(), admin);

      expect(data[0]?.unpublishedTranslationCount).toBe(0);
    });
  });

  describe('englishCount', () => {
    it('counts the translations carrying English, not just whether all do', async () => {
      // The case a boolean cannot express: the entry still appears to an English
      // reader, with fewer senses than a Spanish reader sees.
      entry.findMany.mockResolvedValue([
        listRow({ translations: [{ contentEn: 'man' }, { contentEn: null }] }),
      ] as never);

      const { data } = await service.list(query(), admin);

      expect(data[0]).toMatchObject({ englishCount: 1, translationCount: 2, hasEnglish: false });
    });

    it('reports zero when no translation has English, which is what hides the entry', async () => {
      entry.findMany.mockResolvedValue([
        listRow({ translations: [{ contentEn: null }, { contentEn: null }] }),
      ] as never);

      const { data } = await service.list(query(), admin);

      expect(data[0]).toMatchObject({ englishCount: 0, translationCount: 2, hasEnglish: false });
    });
  });

  describe('hasEnglish', () => {
    it('is true only when every translation carries English', async () => {
      entry.findMany.mockResolvedValue([
        listRow({ translations: [{ contentEn: 'man' }, { contentEn: 'person' }] }),
      ] as never);
      const { data } = await service.list(query(), admin);
      expect(data[0]?.hasEnglish).toBe(true);
    });

    it('is false when any translation lacks English', async () => {
      entry.findMany.mockResolvedValue([
        listRow({ translations: [{ contentEn: 'man' }, { contentEn: null }] }),
      ] as never);
      const { data } = await service.list(query(), admin);
      expect(data[0]?.hasEnglish).toBe(false);
    });

    // [].every(...) is true, so an entry with nothing in it would otherwise
    // report as complete in English.
    it('is false for an entry with no translations', async () => {
      entry.findMany.mockResolvedValue([listRow({ translations: [] })] as never);
      const { data } = await service.list(query(), admin);
      expect(data[0]).toMatchObject({ hasEnglish: false, translationCount: 0 });
    });
  });

  describe('response shape', () => {
    it('returns list items matching AdminEntryListItem exactly', async () => {
      const { data } = await service.list(query(), admin);
      expect(() => AdminEntryListItemSchema.strict().parse(data[0])).not.toThrow();
    });

    // The point of the whole surface: both languages come back unresolved, under
    // the same field names CreateTranslationSchema uses.
    it('returns detail with both locales unresolved', async () => {
      const result = await service.detail('ent_1', admin);
      expect(() => AdminEntryDetailSchema.strict().parse(result)).not.toThrow();
      expect(result.translations[0]).toMatchObject({ contentEs: 'hombre', contentEn: 'man' });
      expect(result.translations[0]).not.toHaveProperty('locale');
      expect(result.translations[0]).not.toHaveProperty('content');
    });
  });
});
