-- Drop PHRASE from the PartOfSpeech enum. Part of speech is a word-level
-- category; a multi-word EXPRESSION entry has no single POS and the entry type
-- already conveys that it is a phrase, so PHRASE-as-POS was redundant.
--
-- Null any translation still tagged with it BEFORE the type swap: the USING
-- cast below fails on any row holding a value absent from the new enum, so this
-- is what keeps the migration safe against data (staging carried a few; prod
-- carries none, where this UPDATE is a harmless no-op).
UPDATE "translations" SET "part_of_speech" = NULL WHERE "part_of_speech" = 'PHRASE';

-- AlterEnum
BEGIN;
CREATE TYPE "PartOfSpeech_new" AS ENUM ('NOUN', 'VERB', 'ADJECTIVE', 'ADVERB', 'PRONOUN', 'PARTICLE', 'PREPOSITION', 'CONJUNCTION', 'OTHER');
ALTER TABLE "translations" ALTER COLUMN "part_of_speech" TYPE "PartOfSpeech_new" USING ("part_of_speech"::text::"PartOfSpeech_new");
ALTER TYPE "PartOfSpeech" RENAME TO "PartOfSpeech_old";
ALTER TYPE "PartOfSpeech_new" RENAME TO "PartOfSpeech";
DROP TYPE "PartOfSpeech_old";
COMMIT;
