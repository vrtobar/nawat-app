-- Provider gains IMPORT, for the author that prisma/import.ts attributes
-- restored content to.
--
-- Additive and non-breaking: no existing row changes, and no code reads the
-- enum exhaustively in a way a new member would break. The value is added here
-- and first used by a later statement in a later session — Postgres allows
-- ALTER TYPE ... ADD VALUE inside a transaction, but forbids USING the new
-- value in that same transaction, so a migration that both added and inserted
-- would fail.
ALTER TYPE "Provider" ADD VALUE 'IMPORT';
