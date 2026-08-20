import { type CreateDialect, DEFAULT_DIALECT_CODE } from '@nahuat/shared';

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
// quietly become wrong. Regional forms are equally valid and carry their own
// dialect code; `common` is what a learner sees when they have not chosen a
// region, which is what makes DictionaryEntryListItem.primaryTranslation — the
// priority=1 translation in this dialect — well defined.
//
// `common`'s description is deliberately not geographic. Nawat predates every
// political boundary that could be used to place it, so framing the language
// through a modern state is both anachronistic and the wrong unit: the
// variation that actually survives is by community. The regional dialects below
// follow the same principle in the other direction — each is named for the
// community that speaks it, not for a department or the country.
//
// The four regional varieties are seeded PROVISIONALLY, for the beta. The
// original design deferred regional codes to avoid baking a guessed taxonomy
// into an FK that every translation points at — but that cost assumed permanent
// data. The beta is disposable: it is torn down and relaunched with definitive
// data, so a guessed model thrown away is cheap. Their purpose is to exercise
// the dialect dimension during the beta — per-dialect priority scoping, dialect
// filtering, and the open question of what primaryTranslation is for an entry
// with no `common` translation — none of which `common` alone can test.
//
// Codes are lowercase slugs of town varieties in Campbell, The Pipil Language
// of El Salvador. They are provisional: the definitive dialect set is re-decided
// at teardown from what real vocabulary shows carries meaning, not carried
// forward by default.
export const DIALECTS: CreateDialect[] = [
  {
    code: DEFAULT_DIALECT_CODE,
    nameEs: 'Nawat común',
    nameEn: 'Common Nawat',
    // User-facing: these strings reach dictionary filters and translation
    // responses via DialectSchema, so they are written for a learner rather
    // than a maintainer. The reasoning above stays here.
    //
    // Both languages are required on Dialect, unlike everywhere else. These
    // rows are authored by the project rather than contributed, so the rule
    // that keeps English optional — never block a Nawat speaker on an English
    // gloss — has nobody to protect here.
    descriptionEs:
      'Formas de uso amplio entre los hablantes de nawat, sin ser propias de una sola comunidad. Se muestra cuando una entrada no tiene distinción regional.',
    descriptionEn:
      'Forms in broad use among Nawat speakers rather than specific to one community. Shown when an entry has no regional distinction.',
  },
  {
    code: 'nahuizalco',
    nameEs: 'Nawat de Nahuizalco',
    nameEn: 'Nahuizalco Nawat',
    descriptionEs: 'Variedad del nawat hablada en la comunidad de Nahuizalco.',
    descriptionEn: 'The variety of Nawat spoken in the community of Nahuizalco.',
  },
  {
    code: 'izalco',
    nameEs: 'Nawat de Izalco',
    nameEn: 'Izalco Nawat',
    descriptionEs: 'Variedad del nawat hablada en la comunidad de Izalco.',
    descriptionEn: 'The variety of Nawat spoken in the community of Izalco.',
  },
  {
    code: 'cuisnahuat',
    nameEs: 'Nawat de Cuisnahuat',
    nameEn: 'Cuisnahuat Nawat',
    descriptionEs: 'Variedad del nawat hablada en la comunidad de Cuisnahuat.',
    descriptionEn: 'The variety of Nawat spoken in the community of Cuisnahuat.',
  },
  {
    code: 'santo-domingo',
    nameEs: 'Nawat de Santo Domingo de Guzmán',
    nameEn: 'Santo Domingo de Guzmán Nawat',
    descriptionEs: 'Variedad del nawat hablada en la comunidad de Santo Domingo de Guzmán.',
    descriptionEn: 'The variety of Nawat spoken in the community of Santo Domingo de Guzmán.',
  },
];
