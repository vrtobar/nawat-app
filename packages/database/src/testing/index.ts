// Test-support for suites that write to a real database.
//
// Exported from this package rather than copied into each workspace because
// there must be exactly ONE definition of "which database may be truncated".
// Two copies is how the answer drifts, and the failure mode of a stale copy
// here is destroying data that is not the suite's to destroy.
//
// Not imported by any runtime code path — it is reachable only through the
// `./testing` subpath, so nothing in the API or the workers can pull it in by
// accident.

// Deployed databases are called `nahuat`. Only the test container is
// `nahuat_test`, and that difference is the whole check.
export const REQUIRED_TEST_DATABASE = 'nahuat_test';

// Matches docker-compose.test.yml, which runs as its own compose project on
// 5434 — deliberately NOT 5433, which is db-tunnel.sh's default local port for
// forwarding a deployed database.
//
// The password is full of URL-special characters on purpose: the RDS-managed
// one is, and a fixture that needs no encoding is a fixture that hides
// encoding bugs. encodeURIComponent here is what every caller must do.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://nahuat:${encodeURIComponent('n4/w@t:p+ss#1')}@localhost:5434/${REQUIRED_TEST_DATABASE}`;

interface QueryableClient {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

// Refuses rather than reports. A suite that truncates tables has no safe way to
// continue against an unexpected database, so this throws and the run stops
// before the first write.
//
// Structurally typed rather than importing PrismaClient: apps/api and this
// package resolve the generated client through different paths, and a nominal
// type here would force one of them to import the other's build output.
export async function assertSafeTestDatabase(client: QueryableClient): Promise<void> {
  const rows = await client.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const actual = rows[0]?.db;

  if (actual !== REQUIRED_TEST_DATABASE) {
    throw new Error(
      `REFUSING to run integration tests against database "${actual}". ` +
        `These tests truncate tables and will only run against "${REQUIRED_TEST_DATABASE}". ` +
        `Check that docker-compose.test.yml is up and that nothing else is bound to its port ` +
        `(a db-tunnel.sh session forwards a DEPLOYED database to localhost:5433).`,
    );
  }
}
