import { z } from 'zod';

import { EntryTypeSchema } from './entry.schema';

// -----------------------------------------------------------------------------
// FLASHCARD SET
// -----------------------------------------------------------------------------

// List item — used on flashcard sets browse page and user profile.
// cardCount helps user see set size before opening it.
export const FlashcardSetListItemSchema = z.object({
  id: z.string(),
  nameEs: z.string(),
  descriptionEs: z.string().nullable(),
  isOfficial: z.boolean(),
  isFeatured: z.boolean(),
  cardCount: z.number().int(),
  owner: z.object({
    name: z.string(),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type FlashcardSetListItem = z.infer<typeof FlashcardSetListItemSchema>;

// Detail — used when opening a set to study or edit.
// cards array includes enough translation data to render flashcard UI.
export const FlashcardCardSchema = z.object({
  id: z.string(), // Flashcard id
  translation: z.object({
    id: z.string(),
    contentEs: z.string(),
    contentEn: z.string().nullable(),
    phonetic: z.string().nullable(),
    audioUrl: z.url().nullable(),
    exampleNawat: z.string().nullable(),
    exampleEs: z.string().nullable(),
    dialectCode: z.string(),
  }),
  entry: z.object({
    id: z.string(),
    nawatContent: z.string(),
    imageUrl: z.url().nullable(),
    type: EntryTypeSchema,
  }),
});

export type FlashcardCard = z.infer<typeof FlashcardCardSchema>;

export const FlashcardSetDetailSchema = FlashcardSetListItemSchema.extend({
  cards: z.array(FlashcardCardSchema),
});

export type FlashcardSetDetail = z.infer<typeof FlashcardSetDetailSchema>;

// -----------------------------------------------------------------------------
// CREATE / UPDATE DTOs
// -----------------------------------------------------------------------------

export const CreateFlashcardSetSchema = z.object({
  nameEs: z.string().min(1).max(200),
  descriptionEs: z.string().optional(),
});

export const UpdateFlashcardSetSchema = CreateFlashcardSetSchema.partial();

// Admin only — toggle official/featured flags
export const AdminUpdateFlashcardSetSchema = z.object({
  isOfficial: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

export const AddFlashcardSchema = z.object({
  translationId: z.string(),
});

export type CreateFlashcardSet = z.infer<typeof CreateFlashcardSetSchema>;
export type UpdateFlashcardSet = z.infer<typeof UpdateFlashcardSetSchema>;
export type AdminUpdateFlashcardSet = z.infer<typeof AdminUpdateFlashcardSetSchema>;
export type AddFlashcard = z.infer<typeof AddFlashcardSchema>;
