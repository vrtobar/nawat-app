import { z } from 'zod';

// -----------------------------------------------------------------------------
// ENUMS
// -----------------------------------------------------------------------------

export const CourseStatusSchema = z.enum(['UNLOCKED', 'COMPLETE']);
export const UnitStatusSchema = z.enum(['LOCKED', 'UNLOCKED', 'COMPLETE']);
export const LessonStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETE']);
export const LessonTypeSchema = z.enum(['STANDARD', 'RECAP']);
export const CardStateSchema = z.enum(['NEW', 'LEARNING', 'REVIEW', 'RELEARNING']);
export const ActivityTypeSchema = z.enum(['LESSON_COMPLETED', 'REVIEW_SESSION']);

export type CourseStatus = z.infer<typeof CourseStatusSchema>;
export type UnitStatus = z.infer<typeof UnitStatusSchema>;
export type LessonStatus = z.infer<typeof LessonStatusSchema>;
export type LessonType = z.infer<typeof LessonTypeSchema>;
export type CardState = z.infer<typeof CardStateSchema>;
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

// -----------------------------------------------------------------------------
// COURSE PROGRESS
// Row created when user first starts a course (clicks "Start Course").
// No LOCKED state — all courses within a published level freely accessible.
// -----------------------------------------------------------------------------

export const UserCourseProgressSchema = z.object({
  courseId: z.string(),
  status: CourseStatusSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export type UserCourseProgress = z.infer<typeof UserCourseProgressSchema>;

// -----------------------------------------------------------------------------
// UNIT PROGRESS
// Used to render course browser node states — LOCKED/UNLOCKED/COMPLETE.
// -----------------------------------------------------------------------------

export const UserUnitProgressSchema = z.object({
  unitId: z.string(),
  status: UnitStatusSchema,
  unlockedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

export type UserUnitProgress = z.infer<typeof UserUnitProgressSchema>;

// -----------------------------------------------------------------------------
// LESSON PROGRESS
// Used to render individual lesson node states on course browser.
// bestScore shown on completed lessons.
// -----------------------------------------------------------------------------

export const UserLessonProgressSchema = z.object({
  lessonId: z.string(),
  status: LessonStatusSchema,
  score: z.number().nullable(), // most recent score
  bestScore: z.number().nullable(), // highest score across all attempts
  attempts: z.number().int(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export type UserLessonProgress = z.infer<typeof UserLessonProgressSchema>;

// -----------------------------------------------------------------------------
// COURSE BROWSER RESPONSE
// Powers the main course browser page — lists all courses in a level
// with user progress overlaid.
// -----------------------------------------------------------------------------

export const CourseSummarySchema = z.object({
  id: z.string(),
  titleEs: z.string(),
  titleEn: z.string().nullable(),
  descriptionEs: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  order: z.number().int(),
  unitCount: z.number().int(),
  lessonCount: z.number().int(),
  progress: UserCourseProgressSchema.nullable(), // null if never started
});

export const LevelWithCoursesSchema = z.object({
  id: z.string(),
  titleEs: z.string(),
  titleEn: z.string().nullable(),
  descriptionEs: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  cefrLabel: z.string().nullable(),
  order: z.number().int(),
  isPublished: z.boolean(),
  courses: z.array(CourseSummarySchema),
});

export type CourseSummary = z.infer<typeof CourseSummarySchema>;
export type LevelWithCourses = z.infer<typeof LevelWithCoursesSchema>;

// -----------------------------------------------------------------------------
// COURSE DETAIL RESPONSE
// Powers the course detail page — shows units and lessons within a course.
// -----------------------------------------------------------------------------

export const CourseUnitSchema = z.object({
  id: z.string(),
  titleEs: z.string(),
  titleEn: z.string().nullable(),
  descriptionEs: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  order: z.number().int(),
  progress: UserUnitProgressSchema.nullable(),
  lessons: z.array(
    z.object({
      id: z.string(),
      titleEs: z.string(),
      titleEn: z.string().nullable(),
      type: LessonTypeSchema,
      order: z.number().int(),
      xpReward: z.number().int(),
      exerciseCount: z.number().int(), // 0 for RECAP (auto-generated)
      progress: UserLessonProgressSchema.nullable(),
    }),
  ),
});

export const CourseDetailSchema = z.object({
  id: z.string(),
  titleEs: z.string(),
  titleEn: z.string().nullable(),
  descriptionEs: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  progress: UserCourseProgressSchema.nullable(),
  units: z.array(CourseUnitSchema),
});

export type CourseUnit = z.infer<typeof CourseUnitSchema>;
export type CourseDetail = z.infer<typeof CourseDetailSchema>;

// -----------------------------------------------------------------------------
// LESSON COMPLETION SUBMISSION
// Posted by frontend when user finishes all exercises in a lesson.
// score = (correctAnswers / totalExercises) * 100
// -----------------------------------------------------------------------------

export const CompleteLessonSchema = z.object({
  lessonId: z.string(),
  score: z.number().min(0).max(100),
});

export type CompleteLesson = z.infer<typeof CompleteLessonSchema>;

// -----------------------------------------------------------------------------
// LESSON COMPLETION RESPONSE
// Returned after lesson completion — frontend uses to animate XP gain,
// streak update, and unit unlock notifications.
// -----------------------------------------------------------------------------

export const LessonCompletionResultSchema = z.object({
  xpEarned: z.number().int(),
  totalXp: z.number().int(), // user's new total XP
  streakUpdated: z.boolean(),
  currentStreak: z.number().int(),
  unitCompleted: z.boolean(), // true if this lesson completed the unit
  unitUnlocked: z.string().nullable(), // id of newly unlocked unit if any
  lessonUnlocked: z.string().nullable(), // id of next unlocked lesson if any
  cardsSeedCount: z.number().int(), // number of SRS cards seeded from vocabulary
});

export type LessonCompletionResult = z.infer<typeof LessonCompletionResultSchema>;

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
