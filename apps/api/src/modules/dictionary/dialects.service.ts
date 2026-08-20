import { prisma } from '@nahuat/database';
import {
  API_ERROR_CODES,
  type CreateDialect,
  type Dialect,
  type UpdateDialect,
} from '@nahuat/shared';
import { ConflictException, Injectable } from '@nestjs/common';

import { isPrismaError, PRISMA_ERROR } from '../../common/prisma-error';
import { dialectNotFound } from './dictionary-errors';

// The columns that make up the Dialect contract, listed once. Selected
// explicitly rather than returning the row, the same discipline as
// UsersService.findProfile: it keeps the `id`-only relation fields and whatever
// a later migration adds from leaking into responses. Every field maps 1:1 to
// DialectSchema and is already the right type — no dates, no enums — so the
// selected row IS the response with nothing further to map.
const DIALECT_SELECT = {
  id: true,
  code: true,
  nameEs: true,
  nameEn: true,
  descriptionEs: true,
  descriptionEn: true,
  precedence: true,
} as const;

@Injectable()
export class DialectsService {
  // Public. The dialect filter on the dictionary and the picker in the
  // translation form both read this. Ordered by code for a stable response;
  // where 'common' sits in a dropdown is a display decision for the frontend,
  // not something to bake into the query.
  list(): Promise<Dialect[]> {
    return prisma.dialect.findMany({
      select: DIALECT_SELECT,
      orderBy: { code: 'asc' },
    });
  }

  async create(input: CreateDialect): Promise<Dialect> {
    try {
      return await prisma.dialect.create({ data: input, select: DIALECT_SELECT });
    } catch (error) {
      // code, nameEs and nameEn each carry a unique constraint. A generic
      // CONFLICT rather than a dialect-specific code: the client cannot act on
      // which of the three collided, and naming it would disclose which values
      // already exist. The admin form edits one dialect at a time.
      if (isPrismaError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) throw conflict();
      throw error;
    }
  }

  async update(id: string, input: UpdateDialect): Promise<Dialect> {
    try {
      return await prisma.dialect.update({
        where: { id },
        data: input,
        select: DIALECT_SELECT,
      });
    } catch (error) {
      // Prisma raises P2025 when the id matches no row — surfaced as
      // DIALECT_NOT_FOUND rather than the bare 404 the router would produce for
      // an unmatched route, so the client can tell "no such dialect" from "no
      // such endpoint".
      if (isPrismaError(error, PRISMA_ERROR.RECORD_NOT_FOUND)) throw dialectNotFound();
      if (isPrismaError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) throw conflict();
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    // Read before write. A bare delete raises P2025 for a missing row and a
    // foreign-key error for an in-use one, and those map to different codes
    // (404 vs 409) — so the state is established explicitly rather than inferred
    // from which error Prisma happens to throw. The code is needed for the
    // reference count below, since translations point at `code`, not `id`.
    const dialect = await prisma.dialect.findUnique({
      where: { id },
      select: { code: true },
    });
    if (!dialect) throw dialectNotFound();

    // Translation.dialect is onDelete: Restrict, so the database would refuse
    // this regardless. The pre-check turns that raw constraint error into
    // DIALECT_IN_USE with a count the admin UI can show. Every translation
    // counts, published or soft-deleted: a soft-deleted row still holds the
    // foreign key, so the delete would still fail.
    const references = await prisma.translation.count({ where: { dialectCode: dialect.code } });
    if (references > 0) throw dialectInUse(references);

    await prisma.dialect.delete({ where: { id } });
  }
}

function conflict(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.CONFLICT,
    message: 'A dialect with that code or name already exists',
  });
}

function dialectInUse(count: number): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.DIALECT_IN_USE,
    message: `Dialect is referenced by ${count} translation${count === 1 ? '' : 's'}`,
  });
}
