import type { JwtClaims, Locale } from '@nahuat/shared';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { resolveContentLocale } from './content-locale.decorator';

// Builds only the three things resolveContentLocale reads. acceptsLanguages is
// Express's negotiator: given the languages we serve, it returns the best match
// or false.
function req(over: {
  query?: Record<string, unknown>;
  stored?: Locale;
  accepts?: Locale | false;
}): Request & { user?: JwtClaims } {
  return {
    query: over.query ?? {},
    user: over.stored ? ({ locale: over.stored } as JwtClaims) : undefined,
    acceptsLanguages: () => over.accepts ?? false,
  } as unknown as Request & { user?: JwtClaims };
}

describe('resolveContentLocale', () => {
  it('prefers an explicit ?locale= over everything else', () => {
    expect(
      resolveContentLocale(req({ query: { locale: 'en' }, stored: 'es', accepts: 'es' })),
    ).toBe('en');
  });

  it('ignores an unusable ?locale= and falls through', () => {
    // A stray value the schema rejects — resolution continues rather than 400s.
    expect(resolveContentLocale(req({ query: { locale: 'fr' }, stored: 'en' }))).toBe('en');
    // Express yields an array for a repeated param; not a valid locale.
    expect(resolveContentLocale(req({ query: { locale: ['es', 'en'] }, accepts: 'en' }))).toBe(
      'en',
    );
  });

  it('uses the stored preference when there is no explicit locale', () => {
    // Beats Accept-Language: a Salvadoran-American may browse in English yet
    // have chosen Spanish.
    expect(resolveContentLocale(req({ stored: 'es', accepts: 'en' }))).toBe('es');
  });

  it('falls back to Accept-Language for an anonymous request', () => {
    expect(resolveContentLocale(req({ accepts: 'en' }))).toBe('en');
  });

  it('defaults to es when nothing resolves', () => {
    expect(resolveContentLocale(req({}))).toBe('es');
    // A token predating the locale claim leaves user.locale undefined.
    expect(resolveContentLocale(req({ stored: undefined, accepts: false }))).toBe('es');
  });
});
