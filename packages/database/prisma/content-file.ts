// The shape of a dictionary export, shared by export.ts and import.ts.
//
// Separate from seed.ts's SeedFileSchema on purpose, even though the two
// describe similar rows. A seed file is a hand-written fixture: it carries
// `$comment`, it has no provenance, and seeding deliberately forces every row
// published so the partial indexes are exercised. An export is a snapshot of
// real rows and has to come back as it left, publication state included. One
// schema covering both would have to make `isPublished` optional, which is
// exactly the field a round trip must not guess at.

import { CreateEntrySchema, CreateTranslationSchema } from '@nahuat/shared';
import { z } from 'zod';

// Bumped when the shape below changes in a way an older importer would read
// wrongly. Import refuses anything it does not recognise rather than doing a
// partial job — a half-restored dictionary looks like a successful one.
//
// Version 1 flattens attribution: an export carries content, not authorship.
// That is a deliberate choice for the pre-launch period, when a single person
// authors everything and `creatorId` therefore distinguishes nothing. It will
// need a version 2 once real contributors exist and provenance starts carrying
// information.
export const FORMAT_VERSION = 1;

// Composed from the shared API schemas rather than restated, same reasoning as
// seed.ts: the export cannot drift from the contract the rows were created
// under. Only `isPublished` is added, because it is state rather than input —
// the API sets it through publish/unpublish, so no create schema mentions it.
export const ExportTranslationSchema = CreateTranslationSchema.extend({
  isPublished: z.boolean(),
});

export const ExportEntrySchema = CreateEntrySchema.extend({
  isPublished: z.boolean(),
  // No `.min(1)`, unlike the seed fixture. A draft entry with no translation
  // yet is a legitimate row in the database, and an export that refused to
  // carry it would quietly drop work in progress — the one thing this exists
  // to prevent.
  translations: z.array(ExportTranslationSchema),
});

export const ExportFileSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  exportedAt: z.string(),
  // Provenance for the file, not for the rows. Answers "which database did
  // this come from" when several exports sit in the same bucket prefix.
  source: z.object({
    database: z.string(),
    host: z.string(),
    // The Postgres server's own address, from inet_server_addr().
    //
    // `host` is the address DIALLED, which through a bastion tunnel is always
    // `localhost` — so it cannot tell a staging export from a production one.
    // This is the address ANSWERED BY THE SERVER, so it names the instance the
    // rows actually came from. It is what makes a file's provenance identifying
    // rather than merely truthful.
    //
    // OPTIONAL, and not a version bump: files written before this field existed
    // are still valid version 1 and must keep importing. It is provenance for a
    // human reading a file after the fact — the enforcement that stops a restore
    // going to the wrong instance is a live comparison in
    // dictionary-backup.sh, which does not consult this field at all. Empty
    // over a unix socket, where inet_server_addr() is NULL.
    serverAddress: z.string().optional(),
  }),
  // Written at export and re-checked at import. The counts are what catches a
  // truncated file: a JSON parse of a partial write usually fails, but a file
  // cut on a record boundary parses fine and restores silently short — which
  // is how the pg_dump problem stayed hidden.
  counts: z.object({
    entries: z.number().int().nonnegative(),
    translations: z.number().int().nonnegative(),
  }),
  entries: z.array(ExportEntrySchema),
});

export type ExportFile = z.infer<typeof ExportFileSchema>;
