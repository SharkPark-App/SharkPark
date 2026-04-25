# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for @sharkpark/backend (NestJS + Prisma v7).
# Built from monorepo root: `docker build -f apps/backend/Dockerfile .`
# Targets Fly.io shared-cpu-1x@512MB (LAX).

ARG NODE_VERSION=22.11.0
ARG PNPM_VERSION=10.20.0

# ─── Base image with pnpm via corepack ─────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ─── Dependencies (cached layer) ───────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
COPY packages/parking-validation/package.json packages/parking-validation/
ENV SKIP_LOCAL_INFRA=1
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sharkpark/backend... --prod=false

# ─── Build stage ───────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json tsconfig.json turbo.json ./
COPY packages packages
COPY apps/backend apps/backend
RUN pnpm --filter @sharkpark/backend exec prisma generate
RUN pnpm --filter @sharkpark/backend run build

# ─── Production deps (prune dev) ───────────────────────────────────────────
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
COPY packages/parking-validation/package.json packages/parking-validation/
ENV SKIP_LOCAL_INFRA=1
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sharkpark/backend... --prod

# ─── Runtime image ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nodejs
WORKDIR /app

# Copy production dependencies (workspace symlinks resolved by pnpm)
COPY --from=prod-deps --chown=nodejs:nodejs /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=nodejs:nodejs /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=prod-deps --chown=nodejs:nodejs /repo/packages ./packages

# Copy build output + Prisma client + schema (needed at runtime for adapter)
COPY --from=build --chown=nodejs:nodejs /repo/apps/backend/dist ./apps/backend/dist
COPY --from=build --chown=nodejs:nodejs /repo/apps/backend/prisma ./apps/backend/prisma
COPY --from=build --chown=nodejs:nodejs /repo/apps/backend/package.json ./apps/backend/package.json

USER nodejs
WORKDIR /app/apps/backend

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# dumb-init forwards SIGTERM properly so Nest shutdown hooks fire
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
