import { describe, expect, it } from 'vitest';

import { slugifyNawat } from './slugify';

describe('slugifyNawat', () => {
  it('lowercases a plain single-word headword', () => {
    expect(slugifyNawat('Takat')).toBe('takat');
  });

  it('folds accents — the fold that is safe for Nawat but not Spanish', () => {
    // "ne" and "nè" fold to the same slug; both being distinct entries is what
    // the @unique slug column catches. See docs/adr/0016.
    expect(slugifyNawat('nè')).toBe('ne');
    expect(slugifyNawat('tàkat')).toBe('takat');
  });

  it('hyphenates multi-word EXPRESSION entries', () => {
    expect(slugifyNawat('ken tinemi')).toBe('ken-tinemi');
    expect(slugifyNawat('ken   tinemi')).toBe('ken-tinemi');
  });

  it('drops apostrophes and other non-alphanumerics', () => {
    expect(slugifyNawat("ne'")).toBe('ne');
    expect(slugifyNawat("ta'wi")).toBe('tawi');
  });

  it('collapses hyphen runs and trims edges', () => {
    expect(slugifyNawat(' -ken - tinemi- ')).toBe('ken-tinemi');
  });
});
