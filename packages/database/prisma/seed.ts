import 'dotenv/config'; // db:seed runs tsx directly — nothing else loads .env

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { buildDatabaseUrl } from '../src/url';

// Same reason as prisma.config.ts: this runs as an ECS task too, where
// DATABASE_URL does not exist and the connection is assembled from DB_*.
const adapter = new PrismaPg({ connectionString: buildDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

async function main() {
  // TODO: seed a default 'base' Dialect row — every Translation requires
  // a dialectCode FK, so nothing else can be seeded until this exists.
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
