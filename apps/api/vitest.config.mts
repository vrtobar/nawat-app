import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Vitest transforms with esbuild by default, which strips types but does NOT
// emit decorator metadata. NestJS resolves constructor dependencies from that
// metadata, so without this plugin every DI-based test fails with "Nest can't
// resolve dependencies" pointing at a parameter that is plainly declared.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globals: false,
  },
});
