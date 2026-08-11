import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Used by the Prisma CLI only (migrate, studio, db seed) — application
// code never reads this file, it connects via the driver adapter in
// src/index.ts instead.
//
// process.env.DATABASE_URL, not the env() helper — env() throws if the
// var is unset at config-load time, which would break `prisma generate`
// (it doesn't need a DB connection) whenever DATABASE_URL isn't set yet.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
