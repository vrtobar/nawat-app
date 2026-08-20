import { prisma } from '@nahuat/database';
import {
  API_ERROR_CODES,
  type CreateTranslation,
  type Locale,
  type TranslationDetail,
  type UpdateTranslation,
} from '@nahuat/shared';
import { ConflictException, Injectable } from '@nestjs/common';

import { isPrismaError, PRISMA_ERROR } from '../../common/prisma-error';
import { dialectNotFound, entryNotFound, translationNotFound } from './dictionary-errors';
import { toTranslationDetail, TRANSLATION_DETAIL_SELECT } from './translation-detail';

@Injectable()
export class TranslationsService {
  // Add a translation to an existing entry (CONTRIBUTOR). The parent comes from
  // the path; dialectCode is chosen here and immutable after. Draft by default —
  // isPublished stays false until an ADMIN publishes it in a later slice.
  async create(
    entryId: string,
    input: CreateTranslation,
    userId: string,
    locale: Locale,
  ): Promise<TranslationDetail> {
    // The entry must exist and be live. Checked first so a translation on a
    // missing or soft-deleted entry is ENTRY_NOT_FOUND rather than a raw FK
    // error.
    const entry = await prisma.entry.findFirst({
      where: { id: entryId, deletedAt: null },
      select: { id: true },
    });
    if (!entry) throw entryNotFound();

    try {
      const created = await prisma.translation.create({
        data: { ...input, entryId, creatorId: userId, updaterId: userId },
        select: TRANSLATION_DETAIL_SELECT,
      });
      return toTranslationDetail(created, locale);
    } catch (error) {
      // One translation per (entry, dialect) — a second for the same dialect
      // collides on the unique constraint.
      if (isPrismaError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) throw translationConflict();
      // dialectCode is a foreign key to Dialect.code; an unknown dialect fails
      // it. Surfaced as DIALECT_NOT_FOUND rather than a 500.
      if (isPrismaError(error, PRISMA_ERROR.FK_CONSTRAINT)) throw dialectNotFound();
      throw error;
    }
  }

  // Update a translation's fields (CONTRIBUTOR). entryId and dialectCode are
  // immutable and absent from the DTO, so nothing here can collide on the unique
  // constraint. updateMany with a `deletedAt: null` guard for the same reason as
  // the entry update: a soft-deleted row reads as not found, not resurrected.
  async update(
    id: string,
    input: UpdateTranslation,
    userId: string,
    locale: Locale,
  ): Promise<TranslationDetail> {
    const result = await prisma.translation.updateMany({
      where: { id, deletedAt: null },
      data: { ...input, updaterId: userId },
    });
    if (result.count === 0) throw translationNotFound();

    const translation = await prisma.translation.findFirst({
      where: { id },
      select: TRANSLATION_DETAIL_SELECT,
    });
    // Unreachable: the row was just updated. The guard keeps the type honest
    // rather than asserting non-null on a nullable findFirst.
    if (!translation) throw translationNotFound();
    return toTranslationDetail(translation, locale);
  }
}

function translationConflict(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This entry already has a translation for that dialect',
  });
}
