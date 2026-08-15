-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'REVIEWER', 'CONTRIBUTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('WORD', 'PHRASE');

-- CreateEnum
CREATE TYPE "PartOfSpeech" AS ENUM ('NOUN', 'VERB', 'ADJECTIVE', 'ADVERB', 'PRONOUN', 'PARTICLE', 'PREPOSITION', 'CONJUNCTION', 'PHRASE', 'OTHER');

-- CreateEnum
CREATE TYPE "CardState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('MULTIPLE_CHOICE', 'LISTEN_SELECT', 'TYPE_ANSWER', 'MATCH_PAIRS', 'TRUE_FALSE', 'BUILD_PHRASE', 'FILL_BLANK', 'LISTEN_TYPE', 'IMAGE_SELECT');

-- CreateEnum
CREATE TYPE "TranslationRole" AS ENUM ('TARGET', 'DISTRACTOR', 'COMPONENT');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('STANDARD', 'RECAP');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('NAHUAT_TO_SPANISH', 'SPANISH_TO_NAHUAT');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('UNLOCKED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('LOCKED', 'UNLOCKED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('LESSON_COMPLETED', 'REVIEW_SESSION');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('ENTRY', 'TRANSLATION', 'DIALECT', 'FLASHCARD_SET', 'FLASHCARD', 'LEVEL', 'COURSE', 'UNIT', 'LESSON', 'EXERCISE', 'USER');

-- CreateTable
CREATE TABLE "levels" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "cefr_label" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "auth0_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT,
    "username_updated_at" TIMESTAMP(3),
    "picture_url" TEXT,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "last_active_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entries" (
    "id" TEXT NOT NULL,
    "type" "EntryType" NOT NULL DEFAULT 'WORD',
    "nahuat_content" TEXT NOT NULL,
    "image_url" TEXT,
    "image_key" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "creator_id" TEXT NOT NULL,
    "updater_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialects" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "dialects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "dialect_code" TEXT NOT NULL,
    "spanish_content" TEXT NOT NULL,
    "english_content" TEXT,
    "phonetic" TEXT,
    "part_of_speech" "PartOfSpeech",
    "example_nahuat" TEXT,
    "example_spanish" TEXT,
    "audio_url" TEXT,
    "audio_key" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "creator_id" TEXT NOT NULL,
    "updater_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashcard_sets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flashcard_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashcards" (
    "id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "translation_id" TEXT NOT NULL,

    CONSTRAINT "flashcards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_card_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "translation_id" TEXT NOT NULL,
    "due" TIMESTAMP(3) NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "elapsed_days" INTEGER NOT NULL DEFAULT 0,
    "scheduled_days" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "state" "CardState" NOT NULL DEFAULT 'NEW',
    "last_review" TIMESTAMP(3),

    CONSTRAINT "user_card_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "level_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "type" "LessonType" NOT NULL DEFAULT 'STANDARD',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "xp_reward" INTEGER NOT NULL DEFAULT 10,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_vocabulary" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "translation_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "lesson_vocabulary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "type" "ExerciseType" NOT NULL,
    "direction" "Direction" NOT NULL DEFAULT 'NAHUAT_TO_SPANISH',
    "order" INTEGER NOT NULL,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_translations" (
    "id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "translation_id" TEXT NOT NULL,
    "role" "TranslationRole" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "exercise_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_course_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "status" "CourseStatus" NOT NULL DEFAULT 'UNLOCKED',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "user_course_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_unit_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'LOCKED',
    "unlocked_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "user_unit_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_lesson_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "status" "LessonStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "score" DOUBLE PRECISION,
    "best_score" DOUBLE PRECISION,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "auto_completed" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "user_lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_lesson_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_lesson_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_activity" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "user_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "user_id" TEXT,
    "changes" JSONB,
    "sqs_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "levels_order_idx" ON "levels"("order");

-- CreateIndex
CREATE INDEX "levels_is_published_idx" ON "levels"("is_published");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth0_id_key" ON "users"("auth0_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "entries_nahuat_content_key" ON "entries"("nahuat_content");

-- CreateIndex
CREATE INDEX "entries_nahuat_content_trgm_idx" ON "entries" USING GIN ("nahuat_content" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "dialects_code_key" ON "dialects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "dialects_name_key" ON "dialects"("name");

-- CreateIndex
CREATE INDEX "translations_spanish_content_idx" ON "translations"("spanish_content");

-- CreateIndex
CREATE INDEX "translations_english_content_idx" ON "translations"("english_content");

-- CreateIndex
CREATE INDEX "translations_dialect_code_idx" ON "translations"("dialect_code");

-- CreateIndex
CREATE INDEX "translations_spanish_content_trgm_idx" ON "translations" USING GIN ("spanish_content" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "translations_english_content_trgm_idx" ON "translations" USING GIN ("english_content" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "translations_entry_id_dialect_code_priority_key" ON "translations"("entry_id", "dialect_code", "priority");

-- CreateIndex
CREATE INDEX "flashcard_sets_user_id_updated_at_idx" ON "flashcard_sets"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "flashcard_sets_is_official_is_featured_updated_at_idx" ON "flashcard_sets"("is_official", "is_featured", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "flashcards_set_id_translation_id_key" ON "flashcards"("set_id", "translation_id");

-- CreateIndex
CREATE INDEX "user_card_progress_user_id_due_idx" ON "user_card_progress"("user_id", "due");

-- CreateIndex
CREATE INDEX "user_card_progress_translation_id_idx" ON "user_card_progress"("translation_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_card_progress_user_id_translation_id_key" ON "user_card_progress"("user_id", "translation_id");

-- CreateIndex
CREATE INDEX "courses_level_id_order_idx" ON "courses"("level_id", "order");

-- CreateIndex
CREATE INDEX "units_course_id_order_idx" ON "units"("course_id", "order");

-- CreateIndex
CREATE INDEX "lessons_unit_id_order_idx" ON "lessons"("unit_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_vocabulary_lesson_id_translation_id_key" ON "lesson_vocabulary"("lesson_id", "translation_id");

-- CreateIndex
CREATE INDEX "exercises_lesson_id_order_idx" ON "exercises"("lesson_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_translations_exercise_id_translation_id_key" ON "exercise_translations"("exercise_id", "translation_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_course_progress_user_id_course_id_key" ON "user_course_progress"("user_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_unit_progress_user_id_unit_id_key" ON "user_unit_progress"("user_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_lesson_progress_user_id_lesson_id_key" ON "user_lesson_progress"("user_id", "lesson_id");

-- CreateIndex
CREATE INDEX "user_lesson_attempts_user_id_lesson_id_idx" ON "user_lesson_attempts"("user_id", "lesson_id");

-- CreateIndex
CREATE INDEX "user_lesson_attempts_user_id_completed_at_idx" ON "user_lesson_attempts"("user_id", "completed_at");

-- CreateIndex
CREATE INDEX "user_lesson_attempts_lesson_id_idx" ON "user_lesson_attempts"("lesson_id");

-- CreateIndex
CREATE INDEX "user_activity_user_id_date_idx" ON "user_activity"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_sqs_message_id_key" ON "audit_logs"("sqs_message_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_id_idx" ON "audit_logs"("entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_updater_id_fkey" FOREIGN KEY ("updater_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_updater_id_fkey" FOREIGN KEY ("updater_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_dialect_code_fkey" FOREIGN KEY ("dialect_code") REFERENCES "dialects"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard_sets" ADD CONSTRAINT "flashcard_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "flashcard_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_translation_id_fkey" FOREIGN KEY ("translation_id") REFERENCES "translations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_card_progress" ADD CONSTRAINT "user_card_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_card_progress" ADD CONSTRAINT "user_card_progress_translation_id_fkey" FOREIGN KEY ("translation_id") REFERENCES "translations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_vocabulary" ADD CONSTRAINT "lesson_vocabulary_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_vocabulary" ADD CONSTRAINT "lesson_vocabulary_translation_id_fkey" FOREIGN KEY ("translation_id") REFERENCES "translations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_translations" ADD CONSTRAINT "exercise_translations_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_translations" ADD CONSTRAINT "exercise_translations_translation_id_fkey" FOREIGN KEY ("translation_id") REFERENCES "translations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_course_progress" ADD CONSTRAINT "user_course_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_course_progress" ADD CONSTRAINT "user_course_progress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_unit_progress" ADD CONSTRAINT "user_unit_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_unit_progress" ADD CONSTRAINT "user_unit_progress_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_lesson_progress" ADD CONSTRAINT "user_lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_lesson_progress" ADD CONSTRAINT "user_lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_lesson_attempts" ADD CONSTRAINT "user_lesson_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_lesson_attempts" ADD CONSTRAINT "user_lesson_attempts_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
