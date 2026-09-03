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
import { authoredBy } from './ownership';
import { ADMIN_TRANSLATION_SELECT, toAdminTranslationDetail } from './translation-detail';

// Columns a list row needs. The nested translations are selected for two
// columns only: translationCount, englishCount, hasEnglish and
// unpublishedTranslationCount are all computed from this array rather than
// fetched per row, so the whole page costs one query. Selecting the columns
// (not a _count aggregate) is what makes those counts answerable at all.
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
    select: { contentEn: true, isPublished: true },
  },
} satisfies Prisma.EntrySelect;

type ListRow = Prisma.EntryGetPayload<{ select: typeof LIST_SELECT }>;

const DETAIL_SELECT = {
  id: true,
  type: true,
  nawatContent: true,
  slug: true,
  imageUrl: true,
  // Status and error only, matching ADMIN_TRANSLATION_SELECT — see the note
  // there. `imageUrl` stays null until an ADMIN approves, so without this the
  // editor cannot tell an entry with no image from one whose image is still
  // being resized. LIST_SELECT above is deliberately not given it: the queue
  // shows what to open, not what is mid-pipeline.
  imageAsset: { select: { status: true, error: true } },
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

  // No caller argument: the detail is no longer per-user. The route is still
  // CONTRIBUTOR-gated, but which rows it will show is not a function of who is
  // asking, so taking the claims here would imply a scoping that does not exist.
  async detail(id: string): Promise<AdminEntryDetail> {
    // Unscoped, deliberately. This backs the editor, and any CONTRIBUTOR+ may
    // edit any entry — refusing to OPEN one they are allowed to CHANGE would be
    // the wrong half of the old model left behind. The 404 now means what it
    // says: no such live entry.
    const entry = await prisma.entry.findFirst({
      where: { id, deletedAt: null },
      select: DETAIL_SELECT,
    });

    if (!entry) throw entryNotFound();

    return toAdminDetail(entry);
  }

  // No ownership predicate. Every CONTRIBUTOR+ caller sees every entry, because
  // every one of them may edit every entry — a read narrower than the write
  // scope would leave rows editable but unopenable. `?mine=true` narrows it by
  // choice. See ./ownership.
  private scope(params: AdminEntriesQuery, user: JwtClaims): Prisma.EntryWhereInput {
    return {
      deletedAt: null,
      ...(params.status === 'draft' ? { isPublished: false } : {}),
      ...(params.status === 'published' ? { isPublished: true } : {}),
      // A live entry holding at least one translation that is not. The only
      // predicate here that reaches through the relation, and the only one
      // entries_drafts_idx (partial on is_published = false) does not help:
      // this asks for the opposite value on the entry and then joins. Left
      // unindexed on purpose — an index before there is a query plan worth
      // reading is a guess, and the table is small enough that the guess would
      // not be checkable.
      ...(params.status === 'pending-translations'
        ? {
            isPublished: true,
            translations: { some: { isPublished: false, deletedAt: null } },
          }
        : {}),
      // 'all' adds no predicate — deletedAt above is the only fence.
      ...(params.type ? { type: params.type } : {}),
      ...(params.q ? { nawatContent: { contains: params.q, mode: 'insensitive' } } : {}),
      ...(params.mine ? authoredBy(user.userId) : {}),
    };
  }
}

function toAdminListItem(entry: ListRow): AdminEntryListItem {
  const translations = entry.translations;

  // Counted once and reused, so englishCount and hasEnglish cannot drift.
  const englishCount = translations.filter((t) => t.contentEn !== null).length;
  const unpublishedTranslationCount = translations.filter((t) => !t.isPublished).length;

  return {
    id: entry.id,
    type: entry.type,
    nawatContent: entry.nawatContent,
    slug: entry.slug,
    imageUrl: entry.imageUrl,
    isPublished: entry.isPublished,
    translationCount: translations.length,
    englishCount,
    unpublishedTranslationCount,
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
    imageStatus: entry.imageAsset?.status ?? null,
    imageError: entry.imageAsset?.error ?? null,
    isPublished: entry.isPublished,
    creator: entry.creator,
    updater: entry.updater,
    translations: entry.translations.map(toAdminTranslationDetail),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
