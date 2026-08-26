import { Prisma, prisma } from '@nahuat/database';
import {
  type AdminEntriesQuery,
  type AdminEntryDetail,
  type AdminEntryListItem,
  type JwtClaims,
  type PaginationMeta,
} from '@nahuat/shared';
import { Injectable } from '@nestjs/common';

import { entryNotFound } from './dictionary-errors';
import { ADMIN_TRANSLATION_SELECT, toAdminTranslationDetail } from './translation-detail';

// Columns a list row needs. The nested translations are selected for their
// contentEn alone: translationCount, englishCount and hasEnglish are computed
// from this array rather than fetched per row, so the whole page costs one
// query. Selecting the column (not a _count aggregate) is what makes the
// English counts answerable at all.
const LIST_SELECT = {
  id: true,
  type: true,
  nawatContent: true,
  slug: true,
  imageUrl: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
  updater: { select: { id: true, name: true } },
  translations: {
    where: { deletedAt: null },
    select: { contentEn: true },
  },
} satisfies Prisma.EntrySelect;

type ListRow = Prisma.EntryGetPayload<{ select: typeof LIST_SELECT }>;

const DETAIL_SELECT = {
  id: true,
  type: true,
  nawatContent: true,
  slug: true,
  imageUrl: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
  updater: { select: { id: true, name: true } },
  translations: {
    // Drafts included — the point of this surface. Soft-deleted rows are not:
    // restoring deleted content is a separate feature with its own decisions.
    where: { deletedAt: null },
    orderBy: [{ dialect: { precedence: 'asc' } }, { dialectCode: 'asc' }],
    select: ADMIN_TRANSLATION_SELECT,
  },
} satisfies Prisma.EntrySelect;

type DetailRow = Prisma.EntryGetPayload<{ select: typeof DETAIL_SELECT }>;

// The authenticated read side of the content-authoring panel. Writes are
// unchanged and live on EntriesController/TranslationsController — this module
// exists because the public reads hardcode `isPublished: true` and cannot show
// a draft, not because the write paths were missing.
@Injectable()
export class AdminEntriesService {
  async list(
    params: AdminEntriesQuery,
    user: JwtClaims,
  ): Promise<{ data: AdminEntryListItem[]; meta: PaginationMeta }> {
    const where = this.scope(params, user);
    const skip = (params.page - 1) * params.limit;

    const [rows, total] = await prisma.$transaction([
      prisma.entry.findMany({
        where,
        // Newest edit first: the queue is worked from the top, and an edit is
        // what moves a row back to the author's attention. Matches the ordering
        // of entries_drafts_idx so the default status=draft page is an index
        // scan rather than a sort.
        orderBy: { updatedAt: 'desc' },
        skip,
        take: params.limit,
        select: LIST_SELECT,
      }),
      prisma.entry.count({ where }),
    ]);

    return {
      data: rows.map(toAdminListItem),
      meta: {
        total,
        page: params.page,
        limit: params.limit,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }

  async detail(id: string, user: JwtClaims): Promise<AdminEntryDetail> {
    const entry = await prisma.entry.findFirst({
      // The scope predicate is reapplied here, not just on the list. Without it
      // a CONTRIBUTOR who guessed or kept an id could read another author's
      // draft directly.
      where: { id, deletedAt: null, ...this.ownership(user) },
      select: DETAIL_SELECT,
    });

    // 404, not 403, when the row exists but belongs to someone else: the two
    // are indistinguishable to the caller on purpose, so this endpoint cannot
    // be used to test whether an id exists.
    if (!entry) throw entryNotFound();

    return toAdminDetail(entry);
  }

  private scope(params: AdminEntriesQuery, user: JwtClaims): Prisma.EntryWhereInput {
    return {
      deletedAt: null,
      ...(params.status === 'draft' ? { isPublished: false } : {}),
      ...(params.status === 'published' ? { isPublished: true } : {}),
      // 'all' adds no predicate — deletedAt above is the only fence.
      ...(params.type ? { type: params.type } : {}),
      ...(params.q ? { nawatContent: { contains: params.q, mode: 'insensitive' } } : {}),
      ...this.ownership(user),
    };
  }

  // Negated against ADMIN rather than matched against CONTRIBUTOR: if a rank is
  // ever added between them, an unrecognised role is scoped to its own rows
  // instead of silently seeing everything.
  private ownership(user: JwtClaims): Prisma.EntryWhereInput {
    return user.role === 'ADMIN' ? {} : { creatorId: user.userId };
  }
}

function toAdminListItem(entry: ListRow): AdminEntryListItem {
  const translations = entry.translations;

  // Counted once and reused, so englishCount and hasEnglish cannot drift.
  const englishCount = translations.filter((t) => t.contentEn !== null).length;

  return {
    id: entry.id,
    type: entry.type,
    nawatContent: entry.nawatContent,
    slug: entry.slug,
    imageUrl: entry.imageUrl,
    isPublished: entry.isPublished,
    translationCount: translations.length,
    englishCount,
    // EVERY translation, and false when there are none — an entry with nothing
    // in it is not "complete in English". `.every` on an empty array is true,
    // which is the trap this guards; comparing counts avoids it by construction.
    hasEnglish: translations.length > 0 && englishCount === translations.length,
    creator: entry.creator,
    updater: entry.updater,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function toAdminDetail(entry: DetailRow): AdminEntryDetail {
  return {
    id: entry.id,
    type: entry.type,
    nawatContent: entry.nawatContent,
    slug: entry.slug,
    imageUrl: entry.imageUrl,
    isPublished: entry.isPublished,
    creator: entry.creator,
    updater: entry.updater,
    translations: entry.translations.map(toAdminTranslationDetail),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
