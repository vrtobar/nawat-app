import {
  ActivityType,
  CardState,
  EntryType,
  Locale as PrismaLocale,
  MediaKind,
  MediaStatus,
  PartOfSpeech,
  Role,
} from '@nahuat/database';
import {
  ActivityTypeSchema,
  CardStateSchema,
  EntryTypeSchema,
  LocaleSchema,
  MediaKindSchema,
  MediaStatusSchema,
  PartOfSpeechSchema,
  RoleSchema,
} from '@nahuat/shared';
import { describe, expect, it } from 'vitest';

// The guard for a drift class that has already bitten once. ActivityTypeSchema
// listed LESSON_COMPLETED after ADR 22 removed it from the Postgres enum, so
// the shared contract advertised a value the database would reject. Nothing
// wrote UserActivity, so nothing failed — it would have typechecked and died at
// the insert, and the consumer most likely to reach it is Python, where no
// TypeScript type would have caught it either.
//
// IT CANNOT LIVE IN packages/shared, which deliberately never imports Prisma
// types — that independence is the point of the package. This is the nearest
// place where both are in scope.
//
// A test rather than a generator, deliberately. Generating the Zod enums from
// Prisma would remove the drift and the ability to differ on purpose with it,
// and Locale below is exactly the case that needs to differ.
describe('shared enums match the Postgres enums', () => {
  const pairs: [string, { options: readonly string[] }, Record<string, string>][] = [
    ['EntryType', EntryTypeSchema, EntryType],
    ['PartOfSpeech', PartOfSpeechSchema, PartOfSpeech],
    ['Role', RoleSchema, Role],
    ['MediaKind', MediaKindSchema, MediaKind],
    ['MediaStatus', MediaStatusSchema, MediaStatus],
    ['CardState', CardStateSchema, CardState],
    ['ActivityType', ActivityTypeSchema, ActivityType],
  ];

  it.each(pairs)('%s', (_name, schema, prismaEnum) => {
    expect([...schema.options].sort()).toEqual(Object.values(prismaEnum).sort());
  });

  // THE DELIBERATE EXCEPTION, asserted rather than omitted. Locale carries
  // three casings on purpose — 'es' on the wire, ES in Postgres, Es as the
  // column suffix — and locale.schema.ts explains why. Asserting the mapping
  // keeps that intent visible next to the rule it breaks, so a future reader
  // does not "fix" it into agreement.
  it('Locale differs by case on purpose, and only by case', () => {
    expect([...LocaleSchema.options].map((l) => l.toUpperCase()).sort()).toEqual(
      Object.values(PrismaLocale).sort(),
    );
  });
});
