import { z } from 'zod';

import { EntryTypeSchema } from './entry.schema';
import {
  FillBlankConfigSchema,
  ImageSelectConfigSchema,
  TrueFalseConfigSchema,
} from './exercise-configs.schema';

// -----------------------------------------------------------------------------
// ENUMS
// -----------------------------------------------------------------------------

export const ExerciseTypeSchema = z.enum([
  // Phase 1 — MVP
  'MULTIPLE_CHOICE',
  'LISTEN_SELECT',
  'TYPE_ANSWER',
  'MATCH_PAIRS',
  'TRUE_FALSE',
  'BUILD_PHRASE',
  // Phase 2 — Post-MVP
  'FILL_BLANK',
  'LISTEN_TYPE',
  'IMAGE_SELECT',
]);

export const DirectionSchema = z.enum(['NAHUAT_TO_SPANISH', 'SPANISH_TO_NAHUAT']);

export const TranslationRoleSchema = z.enum(['TARGET', 'DISTRACTOR', 'COMPONENT']);

export type ExerciseType = z.infer<typeof ExerciseTypeSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type TranslationRole = z.infer<typeof TranslationRoleSchema>;

// -----------------------------------------------------------------------------
// EXERCISE TRANSLATION
// Lean translation shape used within exercise responses.
// Frontend derives the full exercise UI from these rows.
// Includes entry data needed for BUILD_PHRASE tile rendering and tap-to-define.
// -----------------------------------------------------------------------------

export const ExerciseTranslationSchema = z.object({
  id: z.string(),
  role: TranslationRoleSchema,
  order: z.number().int(),
  translation: z.object({
    id: z.string(),
    spanishContent: z.string(),
    englishContent: z.string().nullable(),
    audioUrl: z.url().nullable(),
    phonetic: z.string().nullable(),
    dialectCode: z.string(),
  }),
  entry: z.object({
    id: z.string(),
    nahuatContent: z.string(),
    imageUrl: z.url().nullable(),
    type: EntryTypeSchema,
  }),
});

export type ExerciseTranslation = z.infer<typeof ExerciseTranslationSchema>;

// -----------------------------------------------------------------------------
// CONFIG UNION
// Nullable — most exercise types have no config.
// -----------------------------------------------------------------------------

const ExerciseConfigValueSchema = z
  .union([TrueFalseConfigSchema, FillBlankConfigSchema, ImageSelectConfigSchema])
  .nullable();

// -----------------------------------------------------------------------------
// EXERCISE DETAIL
// Full exercise shape returned to the frontend during a lesson session.
// translations array contains TARGET, DISTRACTOR, and COMPONENT rows.
// Frontend uses type + direction + translations to render the correct UI.
// -----------------------------------------------------------------------------

export const ExerciseDetailSchema = z.object({
  id: z.string(),
  type: ExerciseTypeSchema,
  direction: DirectionSchema,
  order: z.number().int(),
  config: ExerciseConfigValueSchema,
  translations: z.array(ExerciseTranslationSchema),
});

export type ExerciseDetail = z.infer<typeof ExerciseDetailSchema>;

// -----------------------------------------------------------------------------
// CREATE / UPDATE DTOs
// Shallow nesting: POST /lessons/:lessonId/exercises — parent from path.
// config is required for TRUE_FALSE, FILL_BLANK, IMAGE_SELECT — optional
// otherwise. NestJS service validates config presence based on type after
// the initial Zod parse (see ExerciseConfigSchema discriminated union).
// translations array declares which translations to link and with what
// role/order.
// -----------------------------------------------------------------------------

export const ExerciseTranslationInputSchema = z.object({
  translationId: z.string(),
  role: TranslationRoleSchema,
  order: z.number().int().default(0),
});

export const CreateExerciseSchema = z.object({
  type: ExerciseTypeSchema,
  direction: DirectionSchema.default('NAHUAT_TO_SPANISH'),
  order: z.number().int().min(1),
  config: ExerciseConfigValueSchema.optional(),
  translations: z.array(ExerciseTranslationInputSchema).min(1),
});

export const UpdateExerciseSchema = CreateExerciseSchema.partial();

export type CreateExercise = z.infer<typeof CreateExerciseSchema>;
export type UpdateExercise = z.infer<typeof UpdateExerciseSchema>;
export type ExerciseTranslationInput = z.infer<typeof ExerciseTranslationInputSchema>;
