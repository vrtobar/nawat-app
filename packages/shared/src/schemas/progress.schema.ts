import { z } from 'zod';

// =============================================================================
// SPACED REPETITION
//
// What survived the learning hierarchy. ADR 22 deferred Level → Course → Unit
// → Lesson → Exercise and dropped its eleven models; the shapes describing
// course, unit and lesson progress went with them, having never had a caller.
//
// The flashcard subsystem was never downstream of any of that:
// UserCardProgress is keyed on (user, translation), so spaced repetition has
// always been anchored to the dictionary rather than to a curriculum. That is
// why this file has a surviving half at all.
// =============================================================================

// -----------------------------------------------------------------------------
// ENUMS
// -----------------------------------------------------------------------------

export const CardStateSchema = z.enum(['NEW', 'LEARNING', 'REVIEW', 'RELEARNING']);
export type CardState = z.infer<typeof CardStateSchema>;

export const ActivityTypeSchema = z.enum(['LESSON_COMPLETED', 'REVIEW_SESSION']);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

// -----------------------------------------------------------------------------
// SRS — USER CARD PROGRESS
// Used in /review queue and flashcard study view.
// ts-fsrs fields exposed so frontend can run local scheduling previews.
// -----------------------------------------------------------------------------

export const UserCardProgressSchema = z.object({
  translationId: z.string(),
  due: z.iso.datetime(),
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number().int(),
  scheduledDays: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: CardStateSchema,
  lastReview: z.iso.datetime().nullable(),
});

export type UserCardProgress = z.infer<typeof UserCardProgressSchema>;

// -----------------------------------------------------------------------------
// SRS RATING SUBMISSION
// Posted after user rates a flashcard.
// rating maps to ts-fsrs Rating enum: 1=Again, 2=Hard, 3=Good, 4=Easy
// -----------------------------------------------------------------------------

export const SrsRatingSchema = z.object({
  translationId: z.string(),
  rating: z.union([
    z.literal(1), // Again
    z.literal(2), // Hard
    z.literal(3), // Good
    z.literal(4), // Easy
  ]),
});

export type SrsRating = z.infer<typeof SrsRatingSchema>;

// -----------------------------------------------------------------------------
// REVIEW QUEUE ITEM
// Combines SRS progress with full card data for the /review page.
// -----------------------------------------------------------------------------

export const ReviewQueueItemSchema = z.object({
  progress: UserCardProgressSchema,
  translation: z.object({
    id: z.string(),
    contentEs: z.string(),
    contentEn: z.string().nullable(),
    phonetic: z.string().nullable(),
    audioUrl: z.url().nullable(),
    exampleNawat: z.string().nullable(),
    exampleEs: z.string().nullable(),
    exampleEn: z.string().nullable(),
  }),
  entry: z.object({
    id: z.string(),
    nawatContent: z.string(),
    imageUrl: z.url().nullable(),
  }),
});

export const ReviewQueueSchema = z.object({
  items: z.array(ReviewQueueItemSchema),
  totalDue: z.number().int(), // total due cards today
  newCount: z.number().int(), // cards in NEW state
  reviewCount: z.number().int(), // cards in REVIEW state
  learningCount: z.number().int(), // cards in LEARNING or RELEARNING state
});

export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;
export type ReviewQueue = z.infer<typeof ReviewQueueSchema>;
