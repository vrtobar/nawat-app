import { prisma } from '@nahuat/database';
import {
  API_ERROR_CODES,
  type CreateTranslation,
  type JwtClaims,
  type Locale,
  type TranslationDetail,
  type UpdateTranslation,
} from '@nahuat/shared';
import { ConflictException, Injectable } from '@nestjs/common';

import { isPrismaError, PRISMA_ERROR } from '../../common/prisma-error';
import {
  dialectNotFound,
  editConflict,
  entryNotFound,
  publishedEditForbidden,
  translationInUse,
  translationNotFound,
} from './dictionary-errors';
import { translationOwnership } from './ownership';
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
    role: JwtClaims['role'],
    locale: Locale,
  ): Promise<TranslationDetail> {
    // CONTRIBUTOR may edit only drafts — a published translation is refused so
    // live content is not changed without review; ADMIN edits published
    // directly. Read first to decide that and to tell a genuine not-found from a
    // gated-published one; a soft-deleted row is not found.
    // The precondition is not a column — destructured out so it cannot be spread
    // into `data`. Prisma's generated types reject an unknown key there, so
    // forgetting this fails the typecheck rather than at runtime.
    const { expectedUpdatedAt, ...changes } = input;

    // Ownership through the parent entry, in the WHERE rather than as a check
    // after the read — so a translation on another author's entry 404s
    // identically to one that does not exist.
    const existing = await prisma.translation.findFirst({
      where: { id, deletedAt: null, ...translationOwnership(role, userId) },
      select: { isPublished: true },
    });
    if (!existing) throw translationNotFound();
    if (existing.isPublished && role !== 'ADMIN') throw publishedEditForbidden();

    // THE CONDITIONAL UPDATE IS THE AUTHORITY, not the read above. This is the
    // path the editor exercises most, and the one where a lost update is worst:
    // the form sends EVERY field, not a diff, so an unconditional write would
    // push a stale blank over a gloss another contributor had just added, with
    // nothing raised anywhere. Matching updatedAt makes that write match no rows.
    const result = await prisma.translation.updateMany({
      where: {
        id,
        deletedAt: null,
        ...translationOwnership(role, userId),
        updatedAt: new Date(expectedUpdatedAt),
      },
      data: { ...changes, updaterId: userId },
    });

    // The read above established the row exists and is editable, so a miss here
    // means updatedAt moved — or the row was deleted in between, which one extra
    // read tells apart. Paid only on the failure path.
    if (result.count === 0) {
      const stillThere = await prisma.translation.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      throw stillThere ? editConflict('translation') : translationNotFound();
    }

    const translation = await prisma.translation.findFirst({
      where: { id },
      select: TRANSLATION_DETAIL_SELECT,
    });
    // Unreachable barring a delete raced between the two reads; the guard keeps
    // the type honest rather than asserting non-null on a nullable findFirst.
    if (!translation) throw translationNotFound();
    return toTranslationDetail(translation, locale);
  }

  // Delete a translation (ADMIN). Blocked while any learning content references
  // it — removing it would break a flashcard, lesson or exercise whether the row
  // is hidden or dropped — so the in-use check gates both paths. Otherwise a
  // published translation is soft-deleted (kept for history), a draft
  // hard-deleted. The FK backstop catches a reference the count missed.
  async delete(id: string, userId: string): Promise<void> {
    const translation = await prisma.translation.findFirst({
      where: { id, deletedAt: null },
      select: {
        isPublished: true,
        _count: {
          select: {
            flashcards: true,
            lessonVocabulary: true,
            exerciseTranslations: true,
            userCardProgress: true,
          },
        },
      },
    });
    if (!translation) throw translationNotFound();

    const { flashcards, lessonVocabulary, exerciseTranslations, userCardProgress } =
      translation._count;
    const references = flashcards + lessonVocabulary + exerciseTranslations + userCardProgress;
    if (references > 0) throw translationInUse(references);

    if (translation.isPublished) {
      await prisma.translation.update({
        where: { id },
        data: { deletedAt: new Date(), updaterId: userId },
      });
      return;
    }
    try {
      await prisma.translation.delete({ where: { id } });
    } catch (error) {
      if (isPrismaError(error, PRISMA_ERROR.FK_CONSTRAINT)) throw translationInUse();
      throw error;
    }
  }
}

function translationConflict(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'This entry already has a translation for that dialect',
  });
}
