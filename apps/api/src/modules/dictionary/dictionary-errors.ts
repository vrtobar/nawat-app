import { API_ERROR_CODES } from '@nahuat/shared';
import { NotFoundException } from '@nestjs/common';

// Not-found factories shared across the dictionary services. Each maps to its
// resource's *_NOT_FOUND code so a client can tell "no such entry" from "no such
// endpoint" (a bare 404 from the router). Centralized here because more than one
// service raises each: a translation write checks its parent entry exists and
// its dialect exists, and dialect-not-found is raised by both the dialects CRUD
// and the translation writes.
//
// Conflict factories are deliberately NOT here — their messages are
// resource-specific (a duplicate nawatContent versus a duplicate dialect name
// versus a priority collision), so they stay local to each service.

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
