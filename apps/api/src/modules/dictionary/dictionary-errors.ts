import { API_ERROR_CODES } from '@nahuat/shared';
import { ConflictException, NotFoundException } from '@nestjs/common';

// Factories shared across the dictionary services. The not-found ones map to
// their resource's *_NOT_FOUND code so a client can tell "no such entry" from
// "no such endpoint" (a bare 404 from the router). Centralized here because more
// than one service raises each: a translation write checks its parent entry and
// dialect exist, dialect-not-found comes from both the dialects CRUD and the
// translation writes, and translation-in-use is raised by both the single
// translation delete and the entry cascade delete.
//
// The resource-specific *conflict* factories (a duplicate nawatContent, a
// duplicate dialect name) stay local to their service — only the cross-service
// ones live here.

export function entryNotFound(): NotFoundException {
  return new NotFoundException({
    code: API_ERROR_CODES.ENTRY_NOT_FOUND,
    message: 'Entry not found',
  });
}

export function translationNotFound(): NotFoundException {
  return new NotFoundException({
    code: API_ERROR_CODES.TRANSLATION_NOT_FOUND,
    message: 'Translation not found',
  });
}

export function dialectNotFound(): NotFoundException {
  return new NotFoundException({
    code: API_ERROR_CODES.DIALECT_NOT_FOUND,
    message: 'Dialect not found',
  });
}

// A translation cannot be removed while learning content references it — raised
// by the single translation delete and by the entry cascade delete when any of
// the entry's translations is in use. Count-only (the referencing modules are
// not built), and a P2003 backstop maps a reference the count missed here too.
export function translationInUse(count?: number): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.TRANSLATION_IN_USE,
    message: count
      ? `A translation is used by ${count} flashcard, lesson or exercise reference${count === 1 ? '' : 's'}`
      : 'A translation is in use by a flashcard, lesson or exercise',
  });
}
