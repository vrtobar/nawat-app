import 'dotenv/config'; // runs via tsx like seed.ts — nothing else loads .env

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { buildDatabaseUrl } from '../src/url';
import { importFile } from './import-core';

// CLI wrapper. The work is in import-core.ts, which takes a PrismaClient so the
// integration suite can supply one it can observe; everything this file does is
// build the client, read argv, and report.

const adapter = new PrismaPg({ connectionString: buildDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

function filePath(): string {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) {
    throw new Error('Usage: npm run db:import -- <export.json>');
  }
  return path;
}

async function main(): Promise<void> {
  const path = filePath();
  const result = await importFile(prisma, path);

  console.log(
    `imported ${result.entryCount} entries, ${result.translationCount} translations ` +
      `from ${path} (exported ${result.exportedAt} from ${result.sourceDatabase})`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
