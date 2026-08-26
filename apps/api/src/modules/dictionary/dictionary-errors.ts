import { API_ERROR_CODES } from '@nahuat/shared';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

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

// A CONTRIBUTOR may edit only draft content — a published translation or entry
// is refused, so live content is not changed without an admin's review. ADMIN
// edits published content directly. Interim gate for the editorial-review module
// (see BACKLOG): once that exists, a contributor's edit becomes a proposal
// rather than a refusal. Raised by both entry and translation update.
export function publishedEditForbidden(): ForbiddenException {
  return new ForbiddenException({
    code: API_ERROR_CODES.FORBIDDEN,
    message: 'Published content can only be edited by an admin',
  });
}

// A write whose precondition no longer holds: the row moved between the read
// that filled the form and the write submitting it. Raised by both update paths.
//
// A CONFLICT rather than a 412, despite being a failed precondition, because
// the client's recovery is to reload and reapply rather than to retry — and
// because every other refusal in this module already answers in the same
// envelope shape with a machine-readable code. The message names the recovery,
// since the panel surfaces it verbatim.
export function editConflict(resource: 'entry' | 'translation'): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.EDIT_CONFLICT,
    message: `This ${resource} changed since you loaded it — reload and reapply your edit`,
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
