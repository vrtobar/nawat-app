import type { CreateDialect } from '@nahuat/shared';

// REFERENCE DATA — seeded in every environment, including production.
//
// Every Translation carries a dialectCode FK, so nothing else in the
// dictionary can exist until these rows do. That is what makes this
// reference data rather than content: it is structural, identical in every
// environment, and required before the schema is usable at all.
//
// `common` means forms in broad use among speakers — not a standard, and not
// a prestige variant. That distinction is load-bearing rather than diplomatic:
// this is a language with surviving regional variation and few speakers, and a
// dictionary that presents one form as the correct one is how the others
// quietly become wrong. Regional forms are equally valid and get their own
// dialect code; `common` is what a learner sees when they have not chosen a
// region, which is what makes DictionaryEntryListItem.primaryTranslation — the
// priority=1 translation in this dialect — well defined.
//
// The description is deliberately not geographic. Nawat predates every
// political boundary that could be used to place it, so framing the language
// through a modern state is both anachronistic and the wrong unit: the
// variation that actually survives is by community.
//
// Regional variants are deliberately NOT seeded yet. Inventing dialect codes
// before there is vocabulary to justify them would bake a guessed model into
// an FK that every translation points at. Add them when real data shows which
// distinctions carry meaning.
export const DIALECTS: CreateDialect[] = [
  {
    code: 'common',
    nameEs: 'Nawat común',
    // User-facing: this string reaches dictionary filters and translation
    // responses via DialectSchema, so it is written for a learner rather than
    // a maintainer. The reasoning above stays here.
    //
    // Spanish only for now. The English half arrives with descriptionEn in
    // the migration that adds the second locale — writing English into a
    // column named _es to avoid an empty field is how a locale column stops
    // meaning anything.
    descriptionEs:
      'Formas de uso amplio entre los hablantes de nawat, sin ser propias de una sola comunidad. Se muestra cuando una entrada no tiene distinción regional.',
  },
];
