-- Drop the learning hierarchy. See docs/adr/0022.
--
-- Level -> Course -> Unit -> Lesson -> Exercise, their join tables, and the
-- four progress models were designed before the dictionary existed and were
-- never built against: nothing in the application referenced any of them. The
-- first product is the dictionary and flashcards, and these describe a shape
-- that will be redesigned against real content rather than restored.
--
-- EVERY TABLE HERE IS EMPTY, which is what makes this cheap in both
-- directions. The expensive migration is one carrying data; there is none, so
-- re-adding the hierarchy later costs no more than adding it would have.
--
-- The flashcard subsystem is untouched and needs no adjustment: Flashcard
-- references a set and a Translation, and UserCardProgress is keyed on
-- (user, translation). Spaced repetition was already anchored to the
-- dictionary rather than to lessons, so there is no foreign key here to sever.
--
-- ActivityType loses LESSON_COMPLETED, which names an event that can no longer
-- occur. Postgres cannot drop an enum member in place, hence the create-swap-
-- drop below; it is generated, and the surviving member is REVIEW_SESSION,
-- which is the trigger ADR 19 re-scoped the consumer onto.

-- AlterEnum
BEGIN;
CREATE TYPE "ActivityType_new" AS ENUM ('REVIEW_SESSION');
ALTER TABLE "user_activity" ALTER COLUMN "type" TYPE "ActivityType_new" USING ("type"::text::"ActivityType_new");
ALTER TYPE "ActivityType" RENAME TO "ActivityType_old";
ALTER TYPE "ActivityType_new" RENAME TO "ActivityType";
DROP TYPE "public"."ActivityType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_level_id_fkey";

-- DropForeignKey
ALTER TABLE "exercise_translations" DROP CONSTRAINT "exercise_translations_exercise_id_fkey";

-- DropForeignKey
ALTER TABLE "exercise_translations" DROP CONSTRAINT "exercise_translations_translation_id_fkey";

-- DropForeignKey
ALTER TABLE "exercises" DROP CONSTRAINT "exercises_lesson_id_fkey";

-- DropForeignKey
ALTER TABLE "lesson_vocabulary" DROP CONSTRAINT "lesson_vocabulary_lesson_id_fkey";

-- DropForeignKey
ALTER TABLE "lesson_vocabulary" DROP CONSTRAINT "lesson_vocabulary_translation_id_fkey";

-- DropForeignKey
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_unit_id_fkey";

-- DropForeignKey
ALTER TABLE "units" DROP CONSTRAINT "units_course_id_fkey";

-- DropForeignKey
ALTER TABLE "user_course_progress" DROP CONSTRAINT "user_course_progress_course_id_fkey";

-- DropForeignKey
ALTER TABLE "user_course_progress" DROP CONSTRAINT "user_course_progress_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_lesson_attempts" DROP CONSTRAINT "user_lesson_attempts_lesson_id_fkey";

-- DropForeignKey
ALTER TABLE "user_lesson_attempts" DROP CONSTRAINT "user_lesson_attempts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_lesson_progress" DROP CONSTRAINT "user_lesson_progress_lesson_id_fkey";

-- DropForeignKey
ALTER TABLE "user_lesson_progress" DROP CONSTRAINT "user_lesson_progress_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_unit_progress" DROP CONSTRAINT "user_unit_progress_unit_id_fkey";

-- DropForeignKey
ALTER TABLE "user_unit_progress" DROP CONSTRAINT "user_unit_progress_user_id_fkey";

-- DropTable
DROP TABLE "courses";

-- DropTable
DROP TABLE "exercise_translations";

-- DropTable
DROP TABLE "exercises";

-- DropTable
DROP TABLE "lesson_vocabulary";

-- DropTable
DROP TABLE "lessons";

-- DropTable
DROP TABLE "levels";

-- DropTable
DROP TABLE "units";

-- DropTable
DROP TABLE "user_course_progress";

-- DropTable
DROP TABLE "user_lesson_attempts";

-- DropTable
DROP TABLE "user_lesson_progress";

-- DropTable
DROP TABLE "user_unit_progress";

-- DropEnum
DROP TYPE "CourseStatus";

-- DropEnum
DROP TYPE "Direction";

-- DropEnum
DROP TYPE "ExerciseType";

-- DropEnum
DROP TYPE "LessonStatus";

-- DropEnum
DROP TYPE "LessonType";

-- DropEnum
DROP TYPE "TranslationRole";

-- DropEnum
DROP TYPE "UnitStatus";

