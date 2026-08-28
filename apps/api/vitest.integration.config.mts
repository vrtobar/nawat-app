import { TEST_DATABASE_URL } from '@nahuat/database/testing';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Same swc plugin as vitest.config.mts — NestJS resolves constructor
// dependencies from decorator metadata that esbuild does not emit.
//
// Separate config so `test:unit` never picks these up: the unit suite runs
// anywhere with no infrastructure, this one needs docker-compose.test.yml and
// destroys the data it finds.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    // Set BEFORE any module loads. RefreshTokenService imports `prisma` as a
    // module-level singleton from @nahuat/database, which builds its connection
    // string at import time from DATABASE_URL — so a value assigned inside a
    // test file arrives too late and the suite would quietly run against
    // whatever .env points at, which is the development database.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
    include: ['test/integration/**/*.spec.ts'],
    globals: false,
    globalSetup: ['./test/integration/global-setup.ts'],
    // Shared mutable database, and the concurrency tests here deliberately
    // contend on single rows. Parallel files would interleave and fail in ways
    // indistinguishable from the product bugs they exist to detect.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
