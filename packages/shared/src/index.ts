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

// Authentication — the contracts between the web tier and this API as the
// authorization server. After user.schema, which it builds on.
export * from './schemas/auth.schema';

// Dictionary
export * from './schemas/dialect.schema';
export * from './schemas/translation.schema';
export * from './schemas/entry.schema';
export * from './slugify';

// Media — audio and images attached to dictionary rows as a sub-resource
export * from './schemas/media.schema';

// Flashcards
export * from './schemas/flashcard.schema';

// Spaced repetition. The content hierarchy that used to sit above this was
// deferred by ADR 22, and its schemas went with its models.
export * from './schemas/progress.schema';
