import { z } from 'zod';

import { OptimisticLockSchema } from './api-response.schema';
import { DialectSchema } from './dialect.schema';
import { LocaleSchema } from './locale.schema';
import { MediaStatusSchema } from './media.schema';

// -----------------------------------------------------------------------------
// ENUMS
// Defined here and re-exported — avoids duplication with Prisma enums which
// are internal to apps/api only.
// -----------------------------------------------------------------------------

export const PartOfSpeechSchema = z.enum([
  'NOUN',
  'VERB',
  'ADJECTIVE',
  'ADVERB',
  'PRONOUN',
  'PARTICLE',
  'PREPOSITION',
  'CONJUNCTION',
  'OTHER',
]);

export type PartOfSpeech = z.infer<typeof PartOfSpeechSchema>;

// -----------------------------------------------------------------------------
// TRANSLATION DETAIL
// Used within DictionaryEntryDetail and standalone in flashcard/exercise views.
// Includes dialect inline — avoids a separate lookup.
// audioAssetId and the asset's keys are intentionally excluded — a response
// carries audioUrl and nothing else about storage. That URL is written only on
// ADMIN approval (docs/adr/0020), so its presence already means processed,
// verified and approved; exposing the asset would add a second way to reach
// media that has not passed the gate.
//
// RESOLVED CONTENT (ADR 0015 §4). This is a response shape, so `content` and
// `example` are already resolved to one locale server-side — never both
// languages for the client to pick between. Filtering per locale has to be
// server-side for pagination to stay correct, so resolution is too. `content`
// is non-null because a row lacking the resolved locale is filtered out before
// it reaches here; `example` may still be absent in that locale. `locale`
// echoes which language was served — useful when it was resolved from
// Accept-Language or the default rather than an explicit ?locale=, since then
// the client does not otherwise know. The paired columns live only on the
// write DTOs below, where a contributor supplies both.
//
// exampleNawat is not resolved — Nawat is the subject, shown to every learner.
// -----------------------------------------------------------------------------

export const TranslationDetailSchema = z.object({
  id: z.string(),
  content: z.string(),
  example: z.string().nullable(),
  locale: LocaleSchema,
  phonetic: z.string().nullable(),
  partOfSpeech: PartOfSpeechSchema.nullable(),
  exampleNawat: z.string().nullable(),
  audioUrl: z.url().nullable(),
  isPublished: z.boolean(),
  dialect: DialectSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type TranslationDetail = z.infer<typeof TranslationDetailSchema>;

// -----------------------------------------------------------------------------
// CREATE / UPDATE DTOs
// No entryId in the body — shallow nesting: POST /entries/:entryId/translations,
// the parent entry comes from the path. dialectCode stays in the body (chosen
// at creation, immutable after) and is unique per entry: a dialect has at most
// one translation of a word.
//
// A word with several senses is ONE translation with a pipe-separated gloss —
// "hombre | persona" — not several rows. The dictionary backs a learner's
// recall, so a card prompts the whole word; splitting senses into rows would
// make "takat → ?" ambiguous to grade and buys nothing the gloss does not.
// -----------------------------------------------------------------------------

export const CreateTranslationSchema = z.object({
  dialectCode: z.string(),
  // Spanish gloss; multiple senses pipe-separated, e.g. "hombre | persona".
  contentEs: z.string().min(1),
  contentEn: z.string().optional(),
  phonetic: z.string().optional(),
  partOfSpeech: PartOfSpeechSchema.optional(),
  exampleNawat: z.string().optional(),
  exampleEs: z.string().optional(),
  exampleEn: z.string().optional(),
  // NO audioUrl. It is not an omission — the column is written by exactly one
  // thing, an ADMIN approving a MediaAsset (docs/adr/0020), and accepting it
  // here would let a contributor point a published translation at any URL they
  // like, which is the approval gate defeated by a PATCH. Audio is attached
  // through the media sub-resource endpoints instead.
});

// PATCH — every field optional, dialect immutable after creation, and the
// optional ones additionally NULLABLE.
//
// On create, "optional" has one meaning: not supplied. On update it has to
// carry two, because an editor can do two different things to a field it is
// not filling in — leave what is there, or remove it. JSON distinguishes them
// exactly once: an ABSENT key means leave alone, an explicit NULL means clear.
// That is JSON Merge Patch (RFC 7396), and it is the only distinction
// available, since `undefined` does not survive JSON.stringify and never
// reaches the server as a key at all.
//
// Without the nullable half, clearing was impossible and FAILED SILENTLY: the
// key vanished in serialization, the spread in the service left the column
// untouched, and the author watched the value they had just deleted come back
// on the next read.
//
// `contentEs` is deliberately absent from the nullable set. It is the one
// required field on a translation — a row with no Spanish gloss renders
// nowhere — so it can be left alone or replaced, never emptied.
//
// Each nullable field is derived from its create counterpart with .unwrap()
// rather than redeclared, so a change to the underlying rule — a length bound,
// the part-of-speech enum gaining a member — tracks here instead of drifting
// into a second, staler definition.
const createShape = CreateTranslationSchema.shape;

export const UpdateTranslationSchema = CreateTranslationSchema.omit({
  dialectCode: true,
})
  .extend({
    contentEn: createShape.contentEn.unwrap().nullable(),
    phonetic: createShape.phonetic.unwrap().nullable(),
    partOfSpeech: createShape.partOfSpeech.unwrap().nullable(),
    exampleNawat: createShape.exampleNawat.unwrap().nullable(),
    exampleEs: createShape.exampleEs.unwrap().nullable(),
    exampleEn: createShape.exampleEn.unwrap().nullable(),
  })
  .partial()
  .extend({ expectedUpdatedAt: OptimisticLockSchema });

export type CreateTranslation = z.infer<typeof CreateTranslationSchema>;
export type UpdateTranslation = z.infer<typeof UpdateTranslationSchema>;

// -----------------------------------------------------------------------------
// ADMIN TRANSLATION DETAIL
// Used only by the authenticated admin read surface (GET /admin/entries/:id),
// which backs the entry editor.
//
// UNRESOLVED CONTENT — the deliberate inverse of TranslationDetail above. That
// shape resolves to one locale because a learner reads one language and
// pagination has to filter server-side. An editor is the one client that needs
// both: it prefills a form whose fields ARE contentEs and contentEn, so a
// resolved shape cannot round-trip through it. Before this existed no endpoint
// returned both languages of a row — the paired columns appeared only on the
// write DTOs, so a client could send them and never read them back.
//
// The field names match CreateTranslationSchema exactly (contentEs/contentEn,
// exampleEs/exampleEn) rather than the resolved content/example. That is the
// point: the editor PATCHes back the same field names it received, so no
// mapping layer sits between the form and UpdateTranslationSchema where a
// rename could silently drop a field.
//
// No `locale` field, because nothing was resolved. Storage stays excluded
// regardless of who is asking: an editor attaches media through the
// sub-resource endpoints, never by PATCHing a key or a URL back.
// -----------------------------------------------------------------------------

export const AdminTranslationDetailSchema = z.object({
  id: z.string(),
  contentEs: z.string(),
  contentEn: z.string().nullable(),
  exampleNawat: z.string().nullable(),
  exampleEs: z.string().nullable(),
  exampleEn: z.string().nullable(),
  phonetic: z.string().nullable(),
  partOfSpeech: PartOfSpeechSchema.nullable(),
  audioUrl: z.url().nullable(),
  // WHERE AN ATTACHED RECORDING IS IN THE PIPELINE, and null when nothing is
  // attached. AMENDS the exclusion stated at the top of this file, which keeps
  // the asset id and its keys out of every response so that a response cannot
  // become a second route to the object. A processing state is not storage and
  // names nothing reachable, so that reasoning is untouched — and the editor
  // needs this, because `audioUrl` stays null until an ADMIN approves and
  // without it an editor cannot tell an unattached translation from one whose
  // recording is mid-transcode. It rendered empty, and the contributor
  // uploaded again.
  //
  // NO ASSET ID, deliberately, and it turns out none is needed: detaching is
  // DELETE /translations/:id/audio, keyed on the parent.
  //
  // ADMIN SHAPES ONLY. TranslationDetail is unchanged — a reader has no
  // business knowing that a recording exists but is not approved.
  audioStatus: MediaStatusSchema.nullable(),
  // Why processing gave up, for a FAILED asset. Carried so the person who can
  // re-record sees the reason where they are, rather than a bare failure.
  audioError: z.string().nullable(),
  // The provenance written when the recording was uploaded — who is heard,
  // when, on what. Carried for the same reason as the two above: the editor is
  // where a person stands when they need it, and it was otherwise readable
  // only in the media review queue, which a contributor cannot open.
  //
  // ADMIN SHAPES ONLY, like the rest of this block. Consent to be recorded is
  // not consent to be named, so nothing about who is heard belongs on a public
  // response — and no public shape selects it.
  audioNotes: z.string().nullable(),
  isPublished: z.boolean(),
  dialect: DialectSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type AdminTranslationDetail = z.infer<typeof AdminTranslationDetailSchema>;
