# =============================================================================
# NestJS API — multi-stage build
# Build from the REPO ROOT (monorepo needs workspace context):
#   docker build -f apps/api/Dockerfile -t nahuat-api .
#
# The same image runs three ECS workloads:
#   API service      — default CMD
#   migration task   — command override: npm run db:migrate --workspace=@nahuat/database
#   seed task        — command override: npm run db:seed    --workspace=@nahuat/database
# That's why prisma/tsx/dotenv are runtime dependencies of @nahuat/database,
# and why prisma/ + prisma.config.ts ship in the final image.
# =============================================================================

FROM node:24-alpine AS base
WORKDIR /app

# --- deps: install with only manifests present (max layer-cache hits) --------
# --ignore-scripts skips @nahuat/database's postinstall prisma generate,
# which can't run before source is copied. Generation happens in build.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts
# npm nests some dependencies per workspace rather than hoisting them all, so
# `node_modules` alone is not the installation. Downstream stages copy these
# too; mkdir means the COPY works even for a workspace with nothing nested,
# where npm creates no directory at all.
RUN mkdir -p apps/api/node_modules packages/shared/node_modules packages/database/node_modules

# --- build: generate Prisma client, compile shared → database → api ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# After `COPY . .`, which cannot supply these: .dockerignore excludes every
# node_modules from the build context. main.ts imports @nestjs/platform-express
# directly, so its absence here is a COMPILE error, not just a runtime one.
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/packages/database/node_modules packages/database/node_modules
RUN npm run generate --workspace=@nahuat/database \
  && npx turbo run build --filter=api...

# --- prod-deps: strip devDependencies from the installed tree ----------------
# --ignore-scripts again — prune re-runs lifecycle scripts, and the
# database package's postinstall (prisma generate) can't run here.
FROM deps AS prod-deps
RUN npm prune --omit=dev --ignore-scripts

# NPM DOES NOT HOIST EVERYTHING TO THE ROOT, and this stage's output is not one
# tree. `@nestjs/platform-express` installs under apps/api/node_modules — npm
# places it there whether the production tree is reached by pruning this one or
# by a fresh `npm ci --omit=dev`, so it is a layout decision and not an artefact
# of the prune. Copying only the root tree therefore ships an incomplete
# installation, which is what broke every boot of the 2026-09-04 image.

# --- runner ------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup -g 1001 nodejs && adduser -S -u 1001 nestjs

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
# The nested trees too — see prod-deps. main.ts imports the HTTP adapter
# explicitly so it resolves from here rather than from the root.
COPY --from=prod-deps --chown=nestjs:nodejs /app/apps/api/node_modules apps/api/node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /app/packages/database/node_modules packages/database/node_modules
COPY --chown=nestjs:nodejs package.json ./

# Workspace packages — node_modules/@nahuat/* are symlinks into these paths
COPY --from=build --chown=nestjs:nodejs /app/packages/shared/package.json packages/shared/
COPY --from=build --chown=nestjs:nodejs /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=nestjs:nodejs /app/packages/database/package.json packages/database/
COPY --from=build --chown=nestjs:nodejs /app/packages/database/dist packages/database/dist

# Prisma schema + migrations + CLI config — for the migration/seed tasks
COPY --from=build --chown=nestjs:nodejs /app/packages/database/prisma packages/database/prisma
COPY --from=build --chown=nestjs:nodejs /app/packages/database/prisma.config.ts packages/database/
# Generated client source — seed.ts (run via tsx) imports from src/generated
COPY --from=build --chown=nestjs:nodejs /app/packages/database/src packages/database/src

COPY --from=build --chown=nestjs:nodejs /app/apps/api/dist apps/api/dist
COPY --from=build --chown=nestjs:nodejs /app/apps/api/package.json apps/api/

USER nestjs
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
