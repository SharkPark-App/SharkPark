# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for @sharkpark/backend (NestJS + Prisma v7).
# Built from monorepo root: `docker build -f apps/backend/Dockerfile .`
# Targets Fly.io shared-cpu-1x@512MB (LAX).

ARG NODE_VERSION=22.20.0
ARG PNPM_VERSION=10.20.0

# ─── Base image with pnpm via corepack ─────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Upgrade corepack first — Node 22's bundled corepack has stale npm signing
# keys and fails to verify pnpm tarballs. Fixed in corepack >= 0.31.
# https://github.com/nodejs/corepack/issues/612
RUN npm install -g corepack@latest \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ─── Dependencies (cached layer) ───────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
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
ENV SKIP_LOCAL_INFRA=1
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @sharkpark/backend... --prod
# Generated Prisma client lives in node_modules/.prisma/client. The build
# stage runs `prisma generate` against full deps, but the pruned prod tree
# doesn't get the generated files unless we regenerate here.
COPY apps/backend/prisma apps/backend/prisma
RUN pnpm --filter @sharkpark/backend exec prisma generate

# ─── Runtime image ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# postgresql-client-17 is needed by the daily backup cron (pg_dump streams
# Neon → R2). Neon runs PG17, and pg_dump must be ≥ the server version, so
# we install from the PGDG apt repo (Debian bookworm only ships PG15).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSLo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && apt-get purge -y --auto-remove gnupg \
 && rm -rf /var/lib/apt/lists/*

# supercronic — runs the cron process group on Fly. Static binary, ~7MB.
# Pinned by sha1 (project publishes sha1, not sha256). Bump version + checksum
# together when upgrading: https://github.com/aptible/supercronic/releases
ARG SUPERCRONIC_VERSION=v0.2.45
ARG SUPERCRONIC_SHA1=e894b193bea75a5ee644e700c59e30eedc804cf7
RUN curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA1}  /usr/local/bin/supercronic" | sha1sum -c - \
 && chmod +x /usr/local/bin/supercronic

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
COPY --from=build --chown=nodejs:nodejs /repo/apps/backend/cron ./apps/backend/cron
COPY --from=build --chown=nodejs:nodejs /repo/apps/backend/package.json ./apps/backend/package.json
# prisma.config.ts is required at runtime by `prisma migrate deploy` (Prisma 7+).
# It reads DATABASE_URL from env and exposes it as datasource.url.
COPY --from=build --chown=nodejs:nodejs /repo/apps/backend/prisma.config.ts ./apps/backend/prisma.config.ts

USER nodejs
WORKDIR /app/apps/backend

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# dumb-init forwards SIGTERM properly so Nest shutdown hooks fire.
# CMD is overridden by the `cron` process in fly.toml.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
