import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-hosted on ECS — standalone bundles a pruned server into
  // .next/standalone so the Docker image doesn't need node_modules.
  output: 'standalone',

  // Monorepo: trace files from the repo root so workspace deps
  // (@nahuat/*) are included in the standalone output.
  outputFileTracingRoot: path.join(__dirname, '../..'),

  // Stops `next dev` writing AGENTS.md and CLAUDE.md into this directory.
  // Those are agent-directed instructions authored by the framework, and
  // the generated CLAUDE.md imports AGENTS.md, so they load into any AI
  // assistant's context automatically. What goes in the repo is our call.
  agentRules: false,
};

export default nextConfig;
