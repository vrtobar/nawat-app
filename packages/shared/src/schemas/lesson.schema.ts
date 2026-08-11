import { z } from 'zod';

import { EntryTypeSchema } from './entry.schema';
import { ExerciseDetailSchema } from './exercise.schema';

// -----------------------------------------------------------------------------
// COURSE — CREATE / UPDATE DTOs
// Shallow nesting: POST /levels/:levelId/courses — the parent level comes
// from the path, not the body, and is immutable after creation.
// Browse/detail response shapes (CourseSummary, CourseDetail) live in
// progress.schema.ts with progress overlaid.
// -----------------------------------------------------------------------------

export const CreateCourseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  order: z.number().int().min(1),
});

export const UpdateCourseSchema = CreateCourseSchema.partial();

export type CreateCourse = z.infer<typeof CreateCourseSchema>;
export type UpdateCourse = z.infer<typeof UpdateCourseSchema>;

// -----------------------------------------------------------------------------
// UNIT
// -----------------------------------------------------------------------------

// List item — used on course browser / lesson path page.
// Includes lesson count for rendering node states.
export const UnitListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  order: z.number().int(),
  isPublished: z.boolean(),
  lessonCount: z.number().int(), // total published lessons in unit
  createdAt: z.iso.datetime(),
});

export type UnitListItem = z.infer<typeof UnitListItemSchema>;

// Detail — used on admin unit edit form.
export const UnitDetailSchema = UnitListItemSchema.extend({
  updatedAt: z.iso.datetime(),
});

export type UnitDetail = z.infer<typeof UnitDetailSchema>;

// Shallow nesting: POST /courses/:courseId/units — parent from path.
export const CreateUnitSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  order: z.number().int().min(1),
});

export const UpdateUnitSchema = CreateUnitSchema.partial();

export type CreateUnit = z.infer<typeof CreateUnitSchema>;
export type UpdateUnit = z.infer<typeof UpdateUnitSchema>;

// -----------------------------------------------------------------------------
// LESSON VOCABULARY ITEM
// Lean translation shape used in the lesson vocabulary list.
// Full translation available via dictionary endpoints.
// -----------------------------------------------------------------------------

export const LessonVocabularyItemSchema = z.object({
  id: z.string(), // LessonVocabulary id
  order: z.number().int(),
  translation: z.object({
    id: z.string(),
    spanishContent: z.string(),
    englishContent: z.string().nullable(),
    audioUrl: z.url().nullable(),
    partOfSpeech: z.string().nullable(),
  }),
  entry: z.object({
    id: z.string(),
    nahuatContent: z.string(),
    type: EntryTypeSchema,
  }),
});

export type LessonVocabularyItem = z.infer<typeof LessonVocabularyItemSchema>;

// -----------------------------------------------------------------------------
// LESSON
// -----------------------------------------------------------------------------

// List item — used on course browser node rendering and admin lesson table.
// exerciseCount helps admin see lesson completeness at a glance.
export const LessonListItemSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  order: z.number().int(),
  xpReward: z.number().int(),
  isPublished: z.boolean(),
  exerciseCount: z.number().int(),
  vocabularyCount: z.number().int(),
  createdAt: z.iso.datetime(),
});

export type LessonListItem = z.infer<typeof LessonListItemSchema>;

// Detail — used on admin lesson edit form.
// Includes full vocabulary list and exercises for admin management.
export const LessonDetailSchema = LessonListItemSchema.extend({
  vocabulary: z.array(LessonVocabularyItemSchema),
  exercises: z.array(ExerciseDetailSchema),
  updatedAt: z.iso.datetime(),
});

export type LessonDetail = z.infer<typeof LessonDetailSchema>;

// Session — returned when a user starts a lesson.
// Exercises only — no admin fields, no vocabulary list.
// Frontend drives the exercise flow from this response.
export const LessonSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  xpReward: z.number().int(),
  exercises: z.array(ExerciseDetailSchema), // ordered by order asc
});

export type LessonSession = z.infer<typeof LessonSessionSchema>;

// Shallow nesting: POST /units/:unitId/lessons — parent from path.
export const CreateLessonSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  order: z.number().int().min(1),
  xpReward: z.number().int().min(0).default(10),
});

export const UpdateLessonSchema = CreateLessonSchema.partial();

export type CreateLesson = z.infer<typeof CreateLessonSchema>;
export type UpdateLesson = z.infer<typeof UpdateLessonSchema>;

// -----------------------------------------------------------------------------
// LESSON VOCABULARY DTOs
// -----------------------------------------------------------------------------

export const AddLessonVocabularySchema = z.object({
  translationId: z.string(),
  order: z.number().int().min(1),
});

export type AddLessonVocabulary = z.infer<typeof AddLessonVocabularySchema>;
