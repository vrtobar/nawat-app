import { z } from 'zod';

// -----------------------------------------------------------------------------
// LEVEL
// Top of the content hierarchy: Level → Course → Unit → Lesson.
// Levels are permanent infrastructure — no delete/archive, visibility is
// controlled solely by isPublished (unpublished = "Coming Soon" in the UI).
//
// The learner-facing browse shape (LevelWithCourses, with course summaries
// and progress overlaid) lives in progress.schema.ts. This file is the raw
// level shape + admin CRUD DTOs.
// -----------------------------------------------------------------------------

export const LevelSchema = z.object({
  id: z.string(),
  titleEs: z.string(),
  titleEn: z.string().nullable(),
  descriptionEs: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  cefrLabel: z.string().nullable(), // e.g. "A1", "A2", "B1" — optional reference
  order: z.number().int(),
  isPublished: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Level = z.infer<typeof LevelSchema>;

// -----------------------------------------------------------------------------
// CREATE / UPDATE DTOs
// ADMIN only — levels are rarely created, never deleted.
// Publishing goes through a dedicated /publish endpoint like the rest of
// the content hierarchy — isPublished is not settable here.
// -----------------------------------------------------------------------------

export const CreateLevelSchema = z.object({
  titleEs: z.string().min(1).max(200),
  titleEn: z.string().min(1).max(200).optional(),
  descriptionEs: z.string().optional(),
  descriptionEn: z.string().optional(),
  cefrLabel: z.string().max(10).optional(),
  order: z.number().int().min(1),
});

export const UpdateLevelSchema = CreateLevelSchema.partial();

export type CreateLevel = z.infer<typeof CreateLevelSchema>;
export type UpdateLevel = z.infer<typeof UpdateLevelSchema>;
