import { defineConfig } from 'vitest/config';

// Separate from vitest.config.mts so `test:unit` can never pick these up.
// The unit suite runs anywhere with no infrastructure; this one needs
// docker-compose.test.yml and destroys the data it finds, and the two must not
// be one command that behaves differently depending on what is listening.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    globals: false,
    globalSetup: ['./test/integration/global-setup.ts'],
    // Shared mutable database: these truncate tables, so parallel files would
    // interleave and fail in ways that look like product bugs.
    fileParallelism: false,
    // Migrations on a cold container take longer than the 5s default.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
