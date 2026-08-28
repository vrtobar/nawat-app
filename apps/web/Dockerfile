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

FROM node:26-alpine AS base
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
# Dummy Auth0 env — next build prerenders pages and the SDK insists on its env
# being present; real values are injected by ECS at runtime.
#
# Set inline on the RUN rather than as ENV. An ENV instruction bakes the values
# into the stage's layer metadata, where `docker history` can read them back —
# which is why buildkit's SecretsUsedInArgOrEnv check flags it, and the check is
# right even though these particular values are placeholders. Inline, they exist
# only for this process and are recorded nowhere.
RUN AUTH0_DOMAIN=build.placeholder.auth0.com \
    AUTH0_CLIENT_ID=build-placeholder \
    AUTH0_CLIENT_SECRET=build-placeholder \
    AUTH0_SECRET=build-placeholder-secret-32-chars-xx \
    APP_BASE_URL=http://localhost:3000 \
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
