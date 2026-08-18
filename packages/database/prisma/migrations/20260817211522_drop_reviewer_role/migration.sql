-- Remove REVIEWER from the Role enum.
--
-- PostgreSQL has no ALTER TYPE ... DROP VALUE. A label can be added but never
-- removed, so the only route is to build a new type and move the column onto
-- it. Hand-written because Prisma cannot express this: asked to generate it,
-- `migrate dev` emits a warning and stops.
--
-- The order of the five statements is not negotiable:
--
--   1. The old type is renamed rather than dropped, because users.role still
--      depends on it — dropping first fails.
--   2. The default is dropped BEFORE the column's type changes. A default
--      carries its own type, and 'USER'::"Role_old" cannot be coerced during
--      the ALTER, so leaving it in place fails the statement.
--   3. The USING clause casts through text. PostgreSQL has no implicit cast
--      between two enum types, even when every label overlaps.
--   4. The default is restored, now bound to the new type.
--   5. The old type is dropped last, once nothing references it.
--
-- SAFETY: step 3 fails outright if any row still holds 'REVIEWER', because the
-- cast has no target label to land on. That is the intended behaviour — this
-- migration refuses rather than silently rewriting someone's role. Verified
-- beforehand that no row holds it in either local or production.
--
-- users.role is the only column of this type and carries no index, so nothing
-- else needs rebuilding.

ALTER TYPE "Role" RENAME TO "Role_old";

CREATE TYPE "Role" AS ENUM ('USER', 'CONTRIBUTOR', 'ADMIN');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';

DROP TYPE "Role_old";
