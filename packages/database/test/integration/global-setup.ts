import { execFileSync } from 'node:child_process';

import { assertSafeTarget, createTestClient, TEST_DATABASE_URL } from './setup';

// Runs once before the suite. Two jobs: prove the target is the test database,
// then bring its schema up the way a deployed environment does.
//
// `migrate deploy`, not `db push`. The point of an integration suite is to
// exercise what production runs, and production runs the migration files —
// including the hand-written ones that Prisma cannot generate, like the
// accent-insensitive GIN indexes and the immutable_unaccent search_path fix.
// `db push` diffs schema.prisma straight to the database and would skip every
// one of them, leaving the suite green against a schema production never has.
export default async function globalSetup(): Promise<void> {
  const prisma = createTestClient();

  try {
    await assertSafeTarget(prisma);
  } finally {
    await prisma.$disconnect();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
