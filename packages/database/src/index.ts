import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';
import { buildDatabaseUrl } from './url';

export * from './url';

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
