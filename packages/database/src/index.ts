import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

// Two deployment shapes (PLAN §7), one entry point for API and workers:
//   Local:      DATABASE_URL from .env.local
//   Production: individual DB_* fields injected by ECS/Lambda from the
//               AWS-managed RDS secret
export function buildDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const { DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = env;
  if (!DB_USERNAME || !DB_PASSWORD || !DB_HOST || !DB_PORT || !DB_NAME) return undefined;

  // sslmode is required, not optional: RDS ships rds.force_ssl=1 by default,
  // and an unencrypted connection is refused outright with
  // "no pg_hba.conf entry ... no encryption".
  //
  // no-verify encrypts but does not validate the server certificate. Full
  // verification needs the Amazon RDS CA bundle shipped in the image; see
  // BACKLOG.md. Only this branch adds it — local Postgres has no TLS at all,
  // and forcing it there would break development.
  return (
    `postgresql://${encodeURIComponent(DB_USERNAME)}:${encodeURIComponent(DB_PASSWORD)}` +
    `@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=no-verify`
  );
}

// Reuse a single client (and its connection pool) across hot reloads in dev
declare global {
  var __prisma: PrismaClient | undefined;
}

const adapter = new PrismaPg({ connectionString: buildDatabaseUrl() });

export const prisma = globalThis.__prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export * from './generated/prisma/client';
