-- Authentication moved in-house (docs/adr/0018), so the column that named a
-- vendor becomes a pair: who vouched for the person, and the identifier they
-- used.
--
-- HAND-WRITTEN. `prisma migrate dev` cannot detect a rename and generates DROP
-- COLUMN + ADD COLUMN, which discards every existing subject and then fails
-- outright, since a NOT NULL column with no default cannot be added to a table
-- that has rows. A rename preserves the data and the index's contents.
ALTER TABLE "users" RENAME COLUMN "auth0_id" TO "subject";

CREATE TYPE "Provider" AS ENUM ('GOOGLE', 'SEED');

-- The DEFAULT exists only to fill existing rows and is dropped immediately
-- after. Left in place it would let an insert omit the provider and be silently
-- recorded as a Google sign-in — which, for a column whose whole purpose is to
-- say where an identity came from, is the one value that must never be a guess.
--
-- GOOGLE for the backfill because Auth0-era rows were overwhelmingly Google
-- logins, and because these databases are reset before launch: no row this
-- touches survives to production.
ALTER TABLE "users" ADD COLUMN "provider" "Provider" NOT NULL DEFAULT 'GOOGLE';
ALTER TABLE "users" ALTER COLUMN "provider" DROP DEFAULT;

-- `subject` loses its own unique constraint. Two providers may legitimately
-- issue the same string, so only the pair is guaranteed distinct.
DROP INDEX "users_auth0_id_key";
CREATE UNIQUE INDEX "users_provider_subject_key" ON "users"("provider", "subject");
