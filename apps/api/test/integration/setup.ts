import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, prisma } from '@nahuat/database';
import { assertSafeTestDatabase, TEST_DATABASE_URL } from '@nahuat/database/testing';

// The target assertion and connection string come from @nahuat/database/testing
// rather than being restated here. These suites truncate tables, and two
// definitions of "which database may be truncated" is how one goes stale and
// destroys something real.
//
// ⚠️ `prisma` is the same module-level singleton the services use, so it is
// already pointed at the test database by the DATABASE_URL set in
// vitest.integration.config.mts. Asserting against THAT client is the check
// that matters — a guard run against some other connection would prove nothing
// about where the service under test is writing.

export { prisma, TEST_DATABASE_URL };

export async function assertSafeTarget(): Promise<void> {
  await assertSafeTestDatabase(prisma);
}

// A second, independent client for tests that need two connections genuinely
// contending on one row. Prisma pools connections, so parallel calls on one
// client do run concurrently — but a separate client makes the intent explicit
// and removes any doubt that pooling turned a race into a queue.
export function createSecondClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL });
  return new PrismaClient({ adapter });
}
