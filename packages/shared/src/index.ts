// =============================================================================
// @nahuat/shared — barrel exports
// Import from '@nahuat/shared' in apps/api, apps/web, and workers.
// Never import Prisma types in this package — it is framework-agnostic.
// =============================================================================

// API response envelope — import this first, used everywhere
export * from './schemas/api-response.schema';

// Locale — the suffix that names half the columns in the schema
export * from './schemas/locale.schema';

// Users
export * from './schemas/user.schema';

// Dictionary
export * from './schemas/dialect.schema';
export * from './schemas/translation.schema';
export * from './schemas/entry.schema';

// Flashcards
export * from './schemas/flashcard.schema';

// Content hierarchy: Level → Course → Unit → Lesson → Exercise
export * from './schemas/level.schema';
export * from './schemas/exercise-configs.schema';
export * from './schemas/exercise.schema';
export * from './schemas/lesson.schema';

// Progress & SRS
export * from './schemas/progress.schema';
