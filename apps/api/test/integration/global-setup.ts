import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { TEST_DATABASE_URL } from '@nahuat/database/testing';

// Runs once before this workspace's integration suite.
//
// It has to stand alone. turbo may run this package's test:integration without
// having run @nahuat/database's — a filtered run, a cache hit there, or simply
// a different order — so assuming the other suite prepared the database means
// a suite that passes or fails depending on what else ran.
//
// `migrate deploy`, not `db push`: production runs the migration files,
// including hand-written ones Prisma cannot generate, and a schema push would
// skip them.
//
// The reference seed is required rather than incidental — translations carry a
// dialectCode foreign key, so the entry tests cannot create anything without
// dialects present. `db:seed` is the reference-only path, safe to run
// repeatedly and the same one a deploy runs.
const databaseDir = fileURLToPath(new URL('../../../../packages/database', import.meta.url));

export default function globalSetup(): void {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: databaseDir,
    env,
    stdio: 'inherit',
  });

  execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
    cwd: databaseDir,
    env,
    stdio: 'inherit',
  });
}
