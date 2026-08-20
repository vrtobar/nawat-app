import { Prisma, prisma } from '@nahuat/database';
import {
  DEFAULT_DIALECT_CODE,
  type DictionaryBrowseParams,
  type DictionaryEntryDetail,
  type DictionaryEntryListItem,
  type DictionarySearchParams,
  type Locale,
  type PaginationMeta,
} from '@nahuat/shared';
import { Injectable, NotFoundException } from '@nestjs/common';

// Columns needed to render a list row's primaryTranslation and to resolve its
// content to one locale. contentEs and contentEn are both selected so the
// resolver can pick by locale; the rest map straight onto PrimaryTranslation.
const PRIMARY_SELECT = {
  id: true,
  dialectCode: true,
  priority: true,
  partOfSpeech: true,
  phonetic: true,
  audioUrl: true,
  contentEs: true,
  contentEn: true,
} satisfies Prisma.TranslationSelect;

// A browse/search row: the entry columns a list item needs plus its candidate
// translations projected through PRIMARY_SELECT. Derived from that const so the
// row type and the query select cannot drift. The nested where/orderBy do not
// affect this shape, so browse and search share it despite differing filters.
type ListEntryRow = Prisma.EntryGetPayload<{
  select: {
    id: true;
    type: true;
    nawatContent: true;
    imageUrl: true;
    isPublished: true;
    createdAt: true;
    translations: { select: typeof PRIMARY_SELECT };
  };
}>;

// The full translation shape for an entry detail page — every field
// TranslationDetail declares, plus its dialect inline so the client needs no
// second lookup. Paired content/example columns are selected and resolved to
// one locale below; the S3 keys (audioKey, imageKey) are deliberately absent.
const DETAIL_TRANSLATION_SELECT = {
  id: true,
  contentEs: true,
  contentEn: true,
  exampleNawat: true,
  exampleEs: true,
  exampleEn: true,
  phonetic: true,
  partOfSpeech: true,
  audioUrl: true,
  priority: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
  dialect: {
    select: {
      id: true,
      code: true,
      nameEs: true,
      nameEn: true,
      descriptionEs: true,
      descriptionEn: true,
    },
  },
} satisfies Prisma.TranslationSelect;

@Injectable()
export class EntriesService {
  // Public dictionary browse. Live entries only — the ?isPublished param is
  // accepted by the schema but has no effect here: this route is @Public, so
  // there is no req.user to authorize a draft view against. A privileged browse
  // that honours it lands with the authenticated admin paths.
  async browse(
    params: DictionaryBrowseParams,
    locale: Locale,
  ): Promise<{ data: DictionaryEntryListItem[]; meta: PaginationMeta }> {
    // The translation that must exist for an entry to appear, and from which its
    // primary is chosen. Renderable = published, not deleted, and carrying
    // content in the resolved locale. contentEs is non-null in the schema so the
    // locale clause only ever bites for English. dialectCode and partOfSpeech
    // narrow both visibility and the primary pick together, so filtering by
    // ?partOfSpeech=NOUN shows entries with a noun reading, that noun as primary.
    const renderable: Prisma.TranslationWhereInput = {
      isPublished: true,
      deletedAt: null,
      ...(locale === 'en' ? { contentEn: { not: null } } : {}),
      ...(params.dialectCode ? { dialectCode: params.dialectCode } : {}),
      ...(params.partOfSpeech ? { partOfSpeech: params.partOfSpeech } : {}),
    };

    const where: Prisma.EntryWhereInput = {
      isPublished: true,
      deletedAt: null,
      ...(params.type ? { type: params.type } : {}),
      // Semi-join, not a JS filter: an entry with no renderable translation is
      // excluded in SQL so the page counts stay correct. Matches entries_live_idx
      // (WHERE is_published AND deleted_at IS NULL, ordered by nawat_content).
      translations: { some: renderable },
    };

    const { page, limit } = params;

    const [total, rows] = await Promise.all([
      prisma.entry.count({ where }),
      prisma.entry.findMany({
        where,
        orderBy: { nawatContent: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          type: true,
          nawatContent: true,
          imageUrl: true,
          isPublished: true,
          createdAt: true,
          // Same predicate as the semi-join, so a matched entry always carries
          // at least one candidate. Ordered priority-then-dialect: priority is
          // the primary tiebreak; dialect makes equal priorities deterministic.
          translations: {
            where: renderable,
            orderBy: [{ priority: 'asc' }, { dialectCode: 'asc' }],
            select: PRIMARY_SELECT,
          },
        },
      }),
    ]);

    return {
      data: rows.map((entry) => toListItem(entry, locale)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // Public fuzzy search. pg_trgm similarity ranking has no expression in
  // Prisma's query builder — no `%` operator, no ORDER BY similarity() — so the
  // ranking is raw SQL. Every column is wrapped in immutable_unaccent() so the
  // match is accent-insensitive ("takat" finds "tàkat") and uses the functional
  // GIN indexes from 20260820163000_accent_insensitive_trigram_search. The raw
  // query returns ranked ids only; the rows are hydrated through Prisma with the
  // same select and renderable filter as browse, so both endpoints resolve a
  // primary identically and share toListItem.
  async search(
    params: DictionarySearchParams,
    locale: Locale,
  ): Promise<{ data: DictionaryEntryListItem[]; meta: PaginationMeta }> {
    const { q, page, limit } = params;
    const offset = (page - 1) * limit;

    // FROM/WHERE shared by the ranking query and its count, so the page total
    // matches the rows. immutable_unaccent wraps both sides of every match,
    // which folds accents and lets the planner use the functional indexes.
    const enOnly = locale === 'en' ? Prisma.sql`AND t.content_en IS NOT NULL` : Prisma.empty;
    const dialectFilter = params.dialectCode
      ? Prisma.sql`AND t.dialect_code = ${params.dialectCode}`
      : Prisma.empty;
    // The enum column will not compare against a bare text parameter — Postgres
    // needs the cast to the generated "EntryType" type.
    const typeFilter = params.type
      ? Prisma.sql`AND e.type = ${params.type}::"EntryType"`
      : Prisma.empty;

    const matches = Prisma.sql`
      FROM entries e
      JOIN translations t
        ON t.entry_id = e.id
       AND t.is_published = true
       AND t.deleted_at IS NULL
       ${enOnly}
       ${dialectFilter}
      WHERE e.is_published = true
        AND e.deleted_at IS NULL
        ${typeFilter}
        AND (
          immutable_unaccent(e.nawat_content) % immutable_unaccent(${q})
          OR immutable_unaccent(t.content_es) % immutable_unaccent(${q})
          OR (t.content_en IS NOT NULL
              AND immutable_unaccent(t.content_en) % immutable_unaccent(${q}))
        )
    `;

    const [ranked, countRows] = await Promise.all([
      // score is the entry's best match across its headword and any renderable
      // translation, in either language; GREATEST/COALESCE keep a null contentEn
      // from voiding the row. Ordered by score, then headword for a stable tie.
      prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT e.id AS id,
               MAX(GREATEST(
                 similarity(immutable_unaccent(e.nawat_content), immutable_unaccent(${q})),
                 similarity(immutable_unaccent(t.content_es), immutable_unaccent(${q})),
                 COALESCE(similarity(immutable_unaccent(t.content_en), immutable_unaccent(${q})), 0)
               )) AS score
        ${matches}
        GROUP BY e.id
        ORDER BY score DESC, e.nawat_content ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
      prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT e.id) AS count ${matches}
      `),
    ]);

    const total = Number(countRows[0]?.count ?? 0);
    const meta: PaginationMeta = { total, page, limit, totalPages: Math.ceil(total / limit) };

    if (ranked.length === 0) {
      return { data: [], meta };
    }

    // Hydrate the ranked ids. findMany does not preserve `IN (...)` order, so
    // the rows are re-sorted back to the ranking below. The renderable filter
    // mirrors browse (minus partOfSpeech, which search does not take), so the
    // primary is picked from the same candidates the ranking searched.
    const ids = ranked.map((r) => r.id);
    const renderable: Prisma.TranslationWhereInput = {
      isPublished: true,
      deletedAt: null,
      ...(locale === 'en' ? { contentEn: { not: null } } : {}),
      ...(params.dialectCode ? { dialectCode: params.dialectCode } : {}),
    };

    const rows = await prisma.entry.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        nawatContent: true,
        imageUrl: true,
        isPublished: true,
        createdAt: true,
        translations: {
          where: renderable,
          orderBy: [{ priority: 'asc' }, { dialectCode: 'asc' }],
          select: PRIMARY_SELECT,
        },
      },
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = ids.flatMap((id): DictionaryEntryListItem[] => {
      const entry = byId.get(id);
      // An id ranked by the raw query but absent here would mean the raw match
      // and the Prisma renderable filter disagree; skip rather than emit a
      // malformed row. Not expected — the two encode the same predicate.
      return entry ? [toListItem(entry, locale)] : [];
    });

    return { data, meta };
  }

  // Public entry detail. All renderable translations, every dialect, ordered by
  // priority. findFirst rather than findUnique because the visibility predicate
  // is part of the match: an unpublished or soft-deleted entry is reported as
  // not found, identical to one that never existed, so a draft's existence is
  // not disclosed to an anonymous caller.
  async findById(id: string, locale: Locale): Promise<DictionaryEntryDetail> {
    const entry = await prisma.entry.findFirst({
      where: { id, isPublished: true, deletedAt: null },
      select: {
        id: true,
        type: true,
        nawatContent: true,
        imageUrl: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true,
        creator: { select: { name: true } },
        translations: {
          where: {
            isPublished: true,
            deletedAt: null,
            ...(locale === 'en' ? { contentEn: { not: null } } : {}),
          },
          orderBy: [{ priority: 'asc' }, { dialectCode: 'asc' }],
          select: DETAIL_TRANSLATION_SELECT,
        },
      },
    });

    if (!entry) {
      throw new NotFoundException({
        code: 'ENTRY_NOT_FOUND',
        message: 'Entry not found',
      });
    }

    return {
      id: entry.id,
      type: entry.type,
      nawatContent: entry.nawatContent,
      imageUrl: entry.imageUrl,
      isPublished: entry.isPublished,
      creator: { name: entry.creator.name },
      translations: entry.translations.map((t) => ({
        id: t.id,
        content: resolveContent(t, locale),
        example: resolveExample(t, locale),
        locale,
        phonetic: t.phonetic,
        partOfSpeech: t.partOfSpeech,
        exampleNawat: t.exampleNawat,
        audioUrl: t.audioUrl,
        priority: t.priority,
        isPublished: t.isPublished,
        dialect: t.dialect,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }
}

// Maps a browse/search row to a list item, resolving its primary translation
// to one locale. Shared by both endpoints so the headword rule and the
// content resolution live in one place.
function toListItem(entry: ListEntryRow, locale: Locale): DictionaryEntryListItem {
  const primary = pickPrimary(entry.translations);
  return {
    id: entry.id,
    type: entry.type,
    nawatContent: entry.nawatContent,
    imageUrl: entry.imageUrl,
    isPublished: entry.isPublished,
    createdAt: entry.createdAt.toISOString(),
    primaryTranslation: {
      id: primary.id,
      content: resolveContent(primary, locale),
      locale,
      partOfSpeech: primary.partOfSpeech,
      audioUrl: primary.audioUrl,
      phonetic: primary.phonetic,
      dialectCode: primary.dialectCode,
    },
  };
}

// Prefer the common form when the entry has one, whatever its priority —
// otherwise the lowest-priority translation of whatever dialect does exist, so
// a town-only word still gets a headword rather than being dropped. The array
// is pre-ordered by (priority, dialect), so [0] is that lowest-priority form and
// the first common match is the lowest-priority common one. Callers only reach
// here for entries the query already proved have a candidate, so [0] exists.
function pickPrimary<T extends { dialectCode: string }>(translations: T[]): T {
  const primary =
    translations.find((t) => t.dialectCode === DEFAULT_DIALECT_CODE) ?? translations[0];
  if (primary === undefined) {
    // Unreachable: callers only reach here for entries the semi-join proved
    // have a candidate. A throw rather than a silent gap keeps the type honest
    // and turns any future drift into a 500 instead of a malformed row.
    throw new Error('entry matched the browse query but has no candidate translation');
  }
  return primary;
}

// Spanish is mandatory on every translation; English is optional and the read
// queries filter out rows lacking it in the resolved locale. So by the time a
// row reaches here its locale content is present — a null means the query and
// this resolver have drifted apart, surfaced as a 500 rather than smuggled to
// the client as an empty string.
function resolveContent(
  t: { contentEs: string; contentEn: string | null },
  locale: Locale,
): string {
  const value = locale === 'en' ? t.contentEn : t.contentEs;
  if (value === null) {
    throw new Error(`translation missing ${locale} content despite the renderable filter`);
  }
  return value;
}

// The usage example is optional in both languages, so absence is normal and
// stays null rather than throwing.
function resolveExample(
  t: { exampleEs: string | null; exampleEn: string | null },
  locale: Locale,
): string | null {
  return (locale === 'en' ? t.exampleEn : t.exampleEs) ?? null;
}
