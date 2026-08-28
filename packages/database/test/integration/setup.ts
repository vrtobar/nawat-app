import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client';

// The database these tests are allowed to touch, and the only one.
//
// EVERY TEST HERE TRUNCATES TABLES. That makes an integration suite pointed at
// the wrong database indistinguishable from a destructive incident, so the
// target is asserted rather than assumed — twice, by name and by port.
//
// The name check is the one that matters. Deployed databases are called
// `nahuat`; only the test container is `nahuat_test`. A port is overridable by
// an environment variable and a tunnel can occupy any of them, but a connection
// that reports `nahuat` is a deployed database no matter how it was reached.
const REQUIRED_DATABASE = 'nahuat_test';

// Matches docker-compose.test.yml. The password is deliberately full of
// URL-special characters; encodeURIComponent here is what a caller must do,
// and getting it wrong is the bug this fixture exists to expose.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://nahuat:${encodeURIComponent('n4/w@t:p+ss#1')}@localhost:5434/${REQUIRED_DATABASE}`;

export function createTestClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL });
  return new PrismaClient({ adapter });
}

export { TEST_DATABASE_URL, REQUIRED_DATABASE };

// Called once before anything runs. Refuses rather than reporting, because the
// consequence of continuing is destroying data that is not ours.
export async function assertSafeTarget(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ db: string; addr: string | null }[]>`
    SELECT current_database() AS db, host(inet_server_addr()) AS addr
  `;
  const actual = rows[0]?.db;

  if (actual !== REQUIRED_DATABASE) {
    throw new Error(
      `REFUSING to run integration tests against database "${actual}". ` +
        `These tests truncate tables and will only run against "${REQUIRED_DATABASE}". ` +
        `Check that docker-compose.test.yml is up and that nothing else is bound to its port ` +
        `(a db-tunnel.sh session forwards a DEPLOYED database to localhost:5433).`,
    );
  }
}
