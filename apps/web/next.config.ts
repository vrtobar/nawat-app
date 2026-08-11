import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-hosted on ECS — standalone bundles a pruned server into
  // .next/standalone so the Docker image doesn't need node_modules.
  output: 'standalone',

  // Monorepo: trace files from the repo root so workspace deps
  // (@nahuat/*) are included in the standalone output.
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;
