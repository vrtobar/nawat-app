# =============================================================================
# Next.js web — multi-stage build
# Build from the REPO ROOT (monorepo needs workspace context):
#   docker build -f apps/web/Dockerfile -t nahuat-web .
#
# Uses Next's standalone output: next build traces exactly the files the
# server needs into .next/standalone (with outputFileTracingRoot set to
# the repo root so workspace deps are included) — no node_modules copy,
# much smaller image than the API's.
# =============================================================================

FROM node:24-alpine AS base
WORKDIR /app

# --- deps ---------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
RUN npm ci --ignore-scripts

# --- build --------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time env. Real values are injected by ECS at runtime; the build needs
# APP_BASE_URL only because next build prerenders pages that read it. The four
# AUTH0_* placeholders that stood here were removed with ADR 18 — Auth.js
# replaced the Auth0 SDK, and nothing in apps/web reads an AUTH0_* name.
#
# Set inline on the RUN rather than as ENV, and keep anything added here inline
# too. An ENV instruction bakes values into the stage's layer metadata, where
# `docker history` can read them back — which is what buildkit's
# SecretsUsedInArgOrEnv check exists to catch. Inline, they exist only for this
# process and are recorded nowhere.
RUN APP_BASE_URL=http://localhost:3000 \
    npx turbo run build --filter=web

# --- runner -------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 nodejs && adduser -S -u 1001 nextjs

# Standalone server (repo-root layout because of outputFileTracingRoot)
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
# Static assets are NOT part of standalone — served by the same server
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public apps/web/public

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
