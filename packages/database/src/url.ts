// Two deployment shapes, one entry point for API and workers:
//   Local:      DATABASE_URL from .env.local
//   Production: individual DB_* fields injected by ECS/Lambda from the
//               AWS-managed RDS secret, which holds only username and password
//
// Kept out of index.ts because that module constructs a PrismaClient at import
// time — importing it to exercise this function would open a connection pool
// and require a generated client.
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
  // docs/adr/0007-database-connectivity-and-migrations.md. Only this branch
  // adds it — local Postgres has no TLS at all, and forcing it there would
  // break development.
  return (
    `postgresql://${encodeURIComponent(DB_USERNAME)}:${encodeURIComponent(DB_PASSWORD)}` +
    `@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=no-verify`
  );
}
