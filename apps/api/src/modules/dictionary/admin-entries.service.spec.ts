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
    // OWNERSHIP IS ATTRIBUTION, NOT PERMISSION. Every CONTRIBUTOR+ caller sees
    // every entry, because every one of them may edit every entry — a read
    // narrower than the write scope would leave rows editable but unopenable.
    it('does not restrict a CONTRIBUTOR by creator', async () => {
      await service.list(query(), contributor);
      expect(whereOf()).not.toHaveProperty('creatorId');
      expect(whereOf()).not.toHaveProperty('OR');
    });

    it('does not restrict an ADMIN by creator', async () => {
      await service.list(query(), admin);
      expect(whereOf()).not.toHaveProperty('creatorId');
    });

    it('narrows to the caller when ?mine=true, by authorship and not by edits', async () => {
      await service.list(query({ mine: 'true' }), contributor);

      // Created the entry, OR created one of its translations. Updater is
      // deliberately absent: it records only the LAST writer, so an
      // edit-based filter would drop a caller's own work out of this view as
      // soon as anyone else saved that row.
      expect(whereOf()).toMatchObject({
        OR: [
          { creatorId: 'usr_contrib' },
          { translations: { some: { creatorId: 'usr_contrib', deletedAt: null } } },
        ],
      });
    });

    it('applies ?mine=true for an ADMIN too — it is a filter, not a role gate', async () => {
      await service.list(query({ mine: 'true' }), admin);
      expect(whereOf()).toMatchObject({ OR: expect.any(Array) });
    });

    it('leaves detail unscoped, since any contributor may edit any entry', async () => {
      // Refusing to OPEN a row the caller is allowed to CHANGE would be the
      // wrong half of the old model left behind.
      await service.detail('ent_1');
      const where = vi.mocked(entry.findFirst).mock.calls[0]?.[0]?.where;
      expect(where).toMatchObject({ id: 'ent_1', deletedAt: null });
      expect(where).not.toHaveProperty('creatorId');
    });

    // The 404 now means what it says. It used to conflate "no such entry" with
    // "not yours", deliberately, so the endpoint could not be used as an oracle
    // for whether an id existed — a concern that disappears with the scope,
    // since every entry is now readable by every CONTRIBUTOR+ caller anyway.
    it('throws ENTRY_NOT_FOUND when there is no live row with that id', async () => {
      entry.findFirst.mockResolvedValue(null as never);
      await expect(service.detail('ent_x')).rejects.toBeInstanceOf(NotFoundException);
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

    it('is not scoped by creator either — the queue belongs to whoever publishes', async () => {
      // Only an ADMIN can publish, so this view is an ADMIN work queue and the
      // panel hides the tab from anyone else. Scoping it by creator would also
      // have no sensible answer once contributors edit each other's entries:
      // the entry's creator did not add the pending translation, and whoever
      // did does not own the entry.
      entry.findMany.mockResolvedValue([] as never);
      entry.count.mockResolvedValue(0 as never);

      await service.list(query({ status: 'pending-translations' }), contributor);

      expect(vi.mocked(entry.findMany).mock.calls[0]?.[0]?.where).not.toHaveProperty('creatorId');
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
      const result = await service.detail('ent_1');
      expect(() => AdminEntryDetailSchema.strict().parse(result)).not.toThrow();
      expect(result.translations[0]).toMatchObject({ contentEs: 'hombre', contentEn: 'man' });
      expect(result.translations[0]).not.toHaveProperty('locale');
      expect(result.translations[0]).not.toHaveProperty('content');
    });
  });
});
