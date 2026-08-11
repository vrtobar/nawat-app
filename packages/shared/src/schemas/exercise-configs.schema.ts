import { z } from 'zod';

// -----------------------------------------------------------------------------
// EXERCISE CONFIG SCHEMAS
// Only 3 exercise types require config. All others derive everything from
// ExerciseTranslation rows. See Exercise model comment in schema.prisma.
// -----------------------------------------------------------------------------

// TRUE_FALSE
// statement is derived at runtime:
//   isCorrect=true  → "[nahuatContent] means [spanishContent]"
//   isCorrect=false → "[nahuatContent] means [randomDistractorSpanishContent]"
// No statement stored — eliminates staleness when translations are updated.
export const TrueFalseConfigSchema = z.object({
  isCorrect: z.boolean(),
});

// FILL_BLANK
// sentence is hand-authored prose with ___ placeholder.
// Answer derived from TARGET entry.nahuatContent.
// hint is optional — shown as a subtle clue below the blank.
export const FillBlankConfigSchema = z
  .object({
    sentence: z.string().min(1), // must contain ___
    hint: z.string().optional(),
  })
  .refine((data) => data.sentence.includes('___'), {
    error: 'sentence must contain ___ placeholder',
    path: ['sentence'],
  });

// IMAGE_SELECT
// word_from_image — show image, pick correct Nahuat word
// image_from_word — show Nahuat word, pick correct image
// Images sourced from ExerciseTranslation → Translation → Entry → imageUrl.
// NestJS validation must enforce non-null imageUrl on TARGET and all DISTRACTORS.
export const ImageSelectConfigSchema = z.object({
  variant: z.enum(['word_from_image', 'image_from_word']),
});

export type TrueFalseConfig = z.infer<typeof TrueFalseConfigSchema>;
export type FillBlankConfig = z.infer<typeof FillBlankConfigSchema>;
export type ImageSelectConfig = z.infer<typeof ImageSelectConfigSchema>;

// -----------------------------------------------------------------------------
// DISCRIMINATED UNION
// Used by NestJS ZodValidationPipe when creating/updating exercises.
// TypeScript narrows config type based on exercise type automatically.
// -----------------------------------------------------------------------------

export const ExerciseConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TRUE_FALSE'), config: TrueFalseConfigSchema }),
  z.object({ type: z.literal('FILL_BLANK'), config: FillBlankConfigSchema }),
  z.object({ type: z.literal('IMAGE_SELECT'), config: ImageSelectConfigSchema }),
]);

export type ExerciseConfig = z.infer<typeof ExerciseConfigSchema>;
