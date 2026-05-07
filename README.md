# SharkPark

SharkPark is a real-time parking availability system built for California State University, Long Beach (CSULB). The app uses crowdsourced geofencing data from students' phones to estimate how full each campus parking lot is, giving drivers live occupancy information and short-term/long-term forecasts before they leave for campus.

Parking is one of the biggest daily frustrations for commuter students. CSULB has 28 parking lots spread across campus, and during peak hours drivers waste significant time circling lots that are already full. SharkPark solves this by turning every user's phone into an anonymous sensor. When a student's phone enters or exits a parking lot geofence, the app records that event (without storing any personal location data), and the backend aggregates these events into a live occupancy estimate for each lot.

## Table of Contents

- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Key Design Decisions](#key-design-decisions)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Scripts Reference](#scripts-reference)
- [API Endpoints](#api-endpoints)
- [Testing](#testing)
- [Environment Variables](#environment-variables)
- [Docker Services](#docker-services)
- [Project Structure](#project-structure)
- [CI / CD](#ci--cd)
- [Seed Data](#seed-data)
- [License](#license)

---

## How It Works

The core flow has four stages:

1. **Geofence detection** — The mobile app registers geofence regions for each parking lot (using either circular or polygon boundaries). When a student's phone crosses a lot boundary, the OS fires an event that the app intercepts.

2. **Anonymous event recording** — The app sends an ENTER or EXIT event to the backend with the lot ID and a random device UUID (generated once, stored locally, never tied to the user's real identity). The backend immediately hashes this UUID with SHA-256 and a server-side salt before storing anything — the raw device ID is never persisted, and no location coordinates are ever saved server-side.

3. **Occupancy aggregation** — Each event atomically increments or decrements the lot's current occupancy count inside a database transaction. A deduplication layer (the `DeviceState` table) tracks each hashed device's last event type per lot, so duplicate ENTER-ENTER or EXIT-EXIT events are silently ignored. Every 15 minutes, a scheduled job snapshots every lot's occupancy along with metadata (reliability score, academic period, weather, campus status) to build training data for future ML predictions.

4. **Live display** — The mobile app renders a campus map with color-coded lot indicators (green/yellow/orange/red based on occupancy thresholds) and provides short-term forecasts using a time-of-day heuristic model. Students can tap any lot to see detailed occupancy trends, favorite specific lots, and filter by permit type.

### Reliability Scoring

Since occupancy accuracy depends on how many students are actually using the app, every lot gets a real-time **reliability score** computed from five weighted factors:

| Factor | Weight | What it measures |
|--------|--------|-----------------|
| Penetration rate | 35% | Percentage of a lot's capacity represented by app users |
| Data freshness | 25% | How recently the last event was recorded (decays linearly over 60 min) |
| Event frequency | 20% | Number of events in the last hour vs. a target of 10 |
| Sample size | 15% | Unique devices in the last hour vs. a target of 20 |
| Historical accuracy | 5% | Placeholder for future ground-truth comparison |

Scores are classified as HIGH (70+), MEDIUM (40-69), or LOW (<40). Lots with very sparse data enter a "cold start" mode with an explicit low-confidence indicator so students know the estimate may be unreliable.

### Polygon Geofencing

Parking lots are not circles. CSULB has L-shaped structures, narrow rows between buildings, and multi-level garages. SharkPark supports **polygon geofences** defined as arrays of lat/lng vertices stored directly in the database. The mobile app uses a **ray casting algorithm** (even-odd rule) to determine whether a GPS coordinate falls inside a polygon — this handles concave and irregular shapes that circular geofences would either over-cover or under-cover. Each lot stores both polygon coordinates and a centroid/radius for fallback compatibility with iOS's 20-region geofence limit.

---

## Tech Stack

### Why these choices

| Layer | Technology | Why |
|-------|-----------|-----|
| **Mobile** | React Native 0.82, React 19 | Cross-platform (iOS and Android) from a single TypeScript codebase. React Native gives us native performance for GPS tracking and geofencing while sharing business logic across platforms. |
| **Navigation** | React Navigation 7 | Industry standard for React Native screen management. Bottom tab navigator gives students quick access to map, forecasts, and profile. |
| **Auth** | Azure AD SSO via `react-native-app-auth` | CSULB uses Azure Active Directory for all student accounts. Using the university's existing SSO means students log in with their school credentials — no separate account creation, and we can verify they are actual CSULB students. |
| **Backend** | NestJS 11 (Node.js) | TypeScript-native framework with built-in support for modules, dependency injection, guards, pipes, and scheduled tasks. The modular architecture maps cleanly to our domain (lots, users, events, weather, reliability). Comes with first-class testing support. |
| **ORM** | Prisma 7 | Type-safe database queries generated from a schema file (`prisma/schema.prisma`). Catches query errors at compile time instead of runtime, auto-generates migrations, and provides a visual data browser (`prisma studio`). Uses the `@prisma/adapter-pg` driver adapter for direct PostgreSQL connection pooling. |
| **Database** | PostgreSQL 17 (local) / Neon PostgreSQL (production) | Relational model fits our domain well (lots have many snapshots, users have many favorites, events are linked to nearby lots for the in-app notification surface). We run standard PostgreSQL 17 in Docker for local development. In production we use Neon serverless Postgres (us-west-2): branchable, autoscaling, point-in-time recovery up to 7 days. The runtime always connects through Neon's pooled endpoint (`-pooler.`) with `pgbouncer=true` so we survive transaction-mode pooling. The only change between environments is the `DATABASE_URL` connection string. |
| **Hosting** | Fly.io (sharkpark-api, region=lax) | Two-process model on a single Fly app: an `app` process running the HTTP NestJS API (autostop min=0) and a `cron` process running a standalone Nest application context (`scheduler-main.ts`) that owns all 29 `@nestjs/schedule` jobs. Sized at 512 MB each. Rolling deploys gated by `/api/v1/health/ready`. |
| **Object storage** | MinIO (local) / Cloudflare R2 (production) | S3-compatible. Used for nightly `pg_dump` backups (35-day lifecycle) and future ML artifact exports. R2 has zero egress fees — ideal for bandwidth-heavy backup verification. |
| **Observability** | Sentry (errors + Crons) + nestjs-pino logs | Sentry owns errors, performance, and cron monitor check-ins for every scheduled job. nestjs-pino emits structured JSON logs with the process tag (`app` vs `scheduler`) for log-drain filtering. |
| **Security** | Helmet, Throttler, CORS, Passport JWT | Helmet sets security HTTP headers. The throttler rate-limits to 20 requests per 10 seconds per IP. CORS is locked down in production. Passport validates Azure AD JWTs against Microsoft's JWKS endpoint with automatic key rotation. |
| **Monorepo** | pnpm 10 workspaces + Turborepo | pnpm's strict dependency resolution prevents phantom dependencies. Turborepo parallelizes builds, tests, and lints across workspaces with caching. Shared packages (`packages/types`, `packages/utils`) are consumed by both the backend and mobile app. |
| **Infra** | Docker Compose | Single `docker compose up` gives every developer an identical PostgreSQL 17 + MinIO (S3) environment matching production (Neon + R2). The postinstall script automates this so `pnpm install` is the only command needed. |

---

## Architecture

```
┌──────────────────┐   REST / WS   ┌──────────────────────┐
│  React Native    │ ────────────> │  NestJS API (Fly)    │
│  iOS / Android   │ <──────────── │  /api/v1/*           │
│  (apps/mobile)   │  socket.io    │  app process (HTTP)  │
└──────────────────┘               │  cron process        │
                                   │  (scheduler-main.ts) │
                                   └──┬───────────────┬───┘
                                      │ Prisma ORM    │
                              ┌───────▼───────┐  ┌────▼──────────┐
                              │  PostgreSQL   │  │  Redis        │
                              │  (Docker dev) │  │  (Fly Redis   │
                              │  (Neon prod)  │  │   prod cache) │
                              └───────────────┘  └───────────────┘
                                      ▲                  ▲
                              ┌───────┴───────┐  ┌───────┴────────┐
                              │  Cloudflare   │  │  PassioGO WS   │
                              │  R2 backups   │  │  (live shuttle │
                              │  + ML exports │  │   positions)   │
                              └───────────────┘  └────────────────┘
```

Observability is wired through Sentry (errors + cron monitor check-ins for every
scheduled job) and structured JSON logs (nestjs-pino) tagged with the originating
process (`app` vs `scheduler`) for log-drain filtering.

The backend is organized into feature modules, each with its own controller, service, and interfaces:

- **Lots** — CRUD for parking lots, occupancy summaries, historical snapshots, recommendations, short/long-term predictions, and nearby-event impact.
- **Users** — Profile management, favorite lots, notification preferences, account deletion. All endpoints are guarded by Azure AD authentication.
- **Auth** — Azure AD JWT validation (Passport) plus a contributor-grant controller for the elevated permission tier (see [docs/api-access-tiers.md](docs/api-access-tiers.md)).
- **Events** — Campus events (athletic games, graduation, etc.) and their predicted parking impact on nearby lots; backed by scrapers (LBSU sports calendar, general campus events).
- **Occupancy Events** — The core data pipeline: receives anonymous geofence ENTER/EXIT events, deduplicates, updates occupancy atomically, and records snapshots written by the `snapshot.job.ts` cron.
- **Notifications** — FCM push registration plus four user-preference fan-out jobs (full-lots, returning-favorites, predicted-fill, friend-arrived).
- **Reports** — User-submitted lot status reports surfacing crowd-sourced anomalies the geofence pipeline can't see.
- **Reliability** — Real-time confidence scoring for each lot's occupancy estimate, computed from the five-factor weighted model described above.
- **Weather** — Current conditions and 7-day forecast (NWS api.weather.gov), used as ML features and exposed via the `/weather/impact` endpoint.
- **Shuttle Tracker** — Live shuttle tracking via a persistent PassioGO WebSocket connection. Routes, stops, and shuttle metadata are refreshed daily.
- **Scheduler** — Standalone Nest application context (`src/scheduler-main.ts`) that owns all 29 `@nestjs/schedule` jobs (snapshots, weather, transit, backups, retention prune, push fan-out, ML inference, drift checks, etc.). Runs in its own Fly process group with Sentry Cron check-ins and Postgres advisory locks for safe concurrency.
- **Health** — `/api/v1/health/live` (process up) and `/api/v1/health/ready` (DB reachable) probes used by Fly's rolling-deploy health checks.
- **Redis** — Global cache module. Provides shared state for shuttle data across multi-instance deployments.
- **Database** — Global Prisma module with environment-aware connection pooling (pool size 5 locally, 20 in production, SSL required in production). Uses `@prisma/adapter-pg` for direct connection management.
- **Config** — Typed config namespaces (`appConfig`, `authConfig`, `dbConfig`, `weatherConfig`, `notificationsConfig`, `privacyConfig`) with boot-time validation that fails fast on missing required env vars.

The mobile app uses a provider-based architecture:

- **AuthContext** — Manages Azure AD login state and token refresh.
- **SimpleGeofencingProvider** — Initializes GPS tracking, monitors geofence regions, fires anonymous events to the backend, and prevents duplicate alerts via an in-memory set.
- **ThemeContext** — Light/dark mode support.
- **API service layer** — Centralized HTTP client with platform-aware URL resolution (Android emulator uses `10.0.2.2`, iOS simulator uses `localhost`, production uses `api.sharkpark.csulb.edu`).

---

## Key Design Decisions

### Privacy-first data collection

We never store personal location data. The mobile app generates a random UUID once, stores it locally in secure storage, and sends it with each event. The backend hashes it with SHA-256 and a salt before persisting — the raw ID is never written to the database. Only the lot ID (which lot was entered/exited) is stored, never GPS coordinates. Data retention is limited: anonymous raw events are purged after 30 days by a daily cron, logs after 7 days. Rate limits cap events at 100/hour and 1,000/day per device to prevent abuse.

### Atomic occupancy updates

Each ENTER/EXIT event runs inside a Prisma `$transaction` that atomically: (1) creates the event record, (2) increments or decrements the lot's `currentOccupancy`, and (3) upserts the device's state. This prevents race conditions where two simultaneous events could corrupt the count. A floor guard ensures occupancy never drops below zero.

### Forecasting (client + server)

The mobile app falls back to a lightweight time-of-day heuristic (peak multipliers for 8–10 AM and 5–7 PM, low multipliers for 10 PM–6 AM, widened confidence intervals on low-reliability lots) so forecasts still render offline. The primary forecasts come from the ML service (`services/ml/`): a short-term model (next 1–2 h) and a long-term model (rest-of-day) are trained from the snapshot history, exported to MLflow + R2, and served via the backend's `GET /lots/:id/predictions/short-term` and `/predictions/long-term` endpoints. The mobile app prefers the server prediction when available and only falls back to the heuristic on network failure.

### Multi-tenant schema

The database schema is designed around a `School` entity as the top-level tenant. Every lot, user, event, and calendar entry belongs to a school. While we currently only support CSULB, this means the system can be deployed to other universities without schema changes — just add a new school and its associated lot data.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 22 |
| pnpm | 10.20.0 (`corepack enable && corepack prepare pnpm@10.20.0 --activate`) |
| Docker | Latest (for PostgreSQL + MinIO) |
| Xcode | 16+ (iOS builds) |
| Ruby | 3.3.x — installed automatically via `pnpm bootstrap` (uses `rbenv` on macOS) |

> **macOS:** the system Ruby (2.6) is too old for our pinned bundler/CocoaPods. `pnpm bootstrap` installs `rbenv` and the version pinned in `apps/mobile/.ruby-version`. Don't `gem install` against system Ruby.

---

## Getting Started

```bash
# 1. Clone
git clone <repo-url> && cd SharkPark

# 2. Set up environment
cp .env.example .env
# Edit .env with your values (see Environment Variables below).
# For DEVICE_HASH_SALT and DEVICE_EVENT_SECRET, generate with:
#   openssl rand -hex 32

# 3. One-time bootstrap (installs rbenv/Ruby/bundler on macOS, runs bundle install,
#    symlinks apps/backend/.env -> ../../.env). Idempotent — safe to re-run.
pnpm bootstrap

# 4. Install deps (also brings up Docker, runs migrations, seeds the database)
pnpm install

# 5. Start backend (http://localhost:3000)
pnpm --filter @sharkpark/backend dev

# 6. Start the mobile app (in a second terminal)
pnpm --filter mobile ios
```

Run `pnpm dev` from root to start both backend and mobile in parallel.

**What `pnpm bootstrap` does:** Verifies tooling, installs `rbenv` + the project's pinned Ruby (from `apps/mobile/.ruby-version`), installs the bundler version pinned in `Gemfile.lock`, runs `bundle install` for CocoaPods, and symlinks `apps/backend/.env` to the root `.env`. Skip on Linux/CI where the system Ruby is already managed.

**What `pnpm install` does:** Installs all workspace deps. The postinstall hook then starts Docker containers, waits for PostgreSQL, runs Prisma migrations (idempotent), generates the Prisma client, and seeds the database if empty. Set `SKIP_LOCAL_INFRA=1` to skip the Docker bring-up (used in CI).

---

## Scripts Reference

### Root (monorepo)

| Script | Command | Description |
|--------|---------|-------------|
| `pnpm bootstrap` | `bash scripts/bootstrap.sh` | One-time: installs rbenv/Ruby/bundler, runs `bundle install`, links backend `.env` |
| `pnpm install` | — | Install all deps, start Docker, migrate, and seed |
| `pnpm dev` | `turbo run dev --parallel` | Start backend + mobile in parallel |
| `pnpm build` | `turbo run build` | Build all workspaces |
| `pnpm test` | `turbo run test` | Run all tests across workspaces |
| `pnpm lint` | `turbo run lint` | Lint all workspaces |
| `pnpm typecheck` | `turbo run typecheck` | Type-check all workspaces |
| `pnpm format` | `prettier . --check` | Check formatting |
| `pnpm format:fix` | `prettier . --write` | Fix formatting |
| `pnpm db:setup` | `prisma migrate dev` | Create/update database schema |
| `pnpm db:seed` | `prisma db seed` | Seed local database (28 lots, users, events, etc.) |
| `pnpm --filter @sharkpark/backend db:seed:prod` | `ts-node prisma/seed-prod.ts` | Idempotent prod reference seed (school, lots, buildings, geofences, advisories). Auto-runs in CI after migrations; safe to run manually with prod `DATABASE_URL` in `apps/backend/.env.production.local`. |
| `pnpm db:reset` | `prisma migrate reset --force` | Drop DB, re-migrate, re-seed |
| `pnpm db:deploy` | `prisma migrate deploy` | Apply migrations (production) |
| `pnpm db:studio` | `prisma studio` | Open Prisma Studio GUI |
| `pnpm network-ip` | `node scripts/get-network-ip.js` | Print local network IP (for mobile to backend) |

### Backend (`apps/backend`)

| Script | Command | Description |
|--------|---------|-------------|
| `pnpm dev` | `nest start --watch` | Start dev server with hot reload |
| `pnpm start` | `nest start` | Start server |
| `pnpm start:prod` | `node dist/main` | Start production build |
| `pnpm build` | `nest build` | Compile TypeScript |
| `pnpm test` | `jest` | Run 664 unit tests (49 suites) |
| `pnpm test:e2e` | `jest --config jest-e2e.js` | Run E2E tests |
| `pnpm lint` | `eslint .` | Lint backend source |
| `pnpm typecheck` | `tsc --noEmit` | Type-check without emitting |

### Mobile (`apps/mobile`)

| Script | Command | Description |
|--------|---------|-------------|
| `pnpm ios` | `react-native run-ios` | Build and run on iOS simulator |
| `pnpm android` | `react-native run-android` | Build and run on Android emulator |
| `pnpm start` | `react-native start` | Start Metro bundler |
| `pnpm test` | `jest` | Run 655 unit tests (54 suites) |
| `pnpm lint` | `eslint .` | Lint mobile source |
| `pnpm typecheck` | `tsc --noEmit` | Type-check without emitting |

---

## API Endpoints

All endpoints are prefixed with `/api/v1`. The backend runs on port 3000 by default.

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Aggregate liveness + readiness payload |
| `GET` | `/api/v1/health/live` | Process liveness probe (always 200 if event loop is responsive) |
| `GET` | `/api/v1/health/ready` | Readiness probe (verifies DB connectivity) — used by Fly's rolling deploy gate |

### Lots

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/lots` | List all parking lots (filterable by `type`, `available`, `minCapacity`, `maxCapacity`, `search`, `favorite`) |
| `GET` | `/api/v1/lots/summary` | Campus-wide occupancy summary |
| `GET` | `/api/v1/lots/:id` | Get a single lot by ID |
| `GET` | `/api/v1/lots/:id/recommendations` | Recommended alternative lots when this one is full |
| `GET` | `/api/v1/lots/:id/history` | Historical occupancy (`from`, `to` query params) |
| `GET` | `/api/v1/lots/:id/predictions/short-term` | Short-term occupancy prediction (next 1–2 h) |
| `GET` | `/api/v1/lots/:id/predictions/long-term` | Long-term occupancy prediction (rest of day) |
| `GET` | `/api/v1/lots/:id/nearby-events` | Upcoming events that impact this lot |

### Users (authenticated)

All user endpoints require Azure AD authentication.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/users/:userId` | Get user profile |
| `GET` | `/api/v1/users/:userId/favorites` | List favorite lots |
| `POST` | `/api/v1/users/:userId/favorites/:lotId` | Add a lot to favorites |
| `DELETE` | `/api/v1/users/:userId/favorites/:lotId` | Remove a favorite lot |
| `PATCH` | `/api/v1/users/:userId/notifications` | Update notification preferences |
| `DELETE` | `/api/v1/users/me` | Delete the authenticated user's own account |
| `DELETE` | `/api/v1/users/:userId` | Delete a user (admin) |
| `POST` | `/api/v1/users/me/push-token` | Register / refresh an Expo push token (Notifications module) |

### Auth (admin)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/contributor/grant` | Grant contributor role to a user (admin) |
| `POST` | `/api/v1/auth/contributor/revoke` | Revoke contributor role from a user (admin) |

### Events

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/events/for-lot/:lotId` | Upcoming campus events impacting a specific lot |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/reports` | Submit a crowd-sourced lot status report |

### Weather

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/weather/current` | Current conditions + 7-day NWS forecast |
| `GET` | `/api/v1/weather/impact` | Weather-driven parking demand modifier per lot |

### Occupancy Events

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/occupancy-events` | Record anonymous geofencing ENTER/EXIT event (HMAC-signed) |
| `GET` | `/api/v1/occupancy-events/lots/:lotId` | Events for a lot in a date range (`from`, `to`, `type`) |
| `GET` | `/api/v1/occupancy-events/lots/:lotId/stats` | Enter/exit counts for a lot (`from`, `to`) |
| `GET` | `/api/v1/occupancy-events/snapshots/:lotId` | Persisted hourly snapshots for a lot (`from`, `to`) |

### Reliability

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/reliability/lots/:lotId` | Reliability score for a specific lot |
| `GET` | `/api/v1/reliability/lots` | Reliability scores for all lots |
| `GET` | `/api/v1/reliability/config` | Reliability computation config (weights and thresholds) |

### Transit

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/transit/shuttles` | List of active shuttles & their data |
| `GET` | `/api/v1/transit/routes` | Active routes with coordinates |
| `GET` | `/api/v1/transit/stops` | All stops with coordinates and route assignments |
| `GET` | `/api/v1/transit/etas/:stopId` | Upcoming arrivals at a stop, sorted by ETA |

#### Shuttle WebSocket

| Property | Value |
|----------|-------|
| Namespace | `/shuttles` |
| socket.io path | `/api/v1/socket.io/` |
| Transport | `websocket` |
| Auth | Requires the `WS_CONNECT_SECRET` handshake token |
| Event | `shuttle_update` → `ShuttleLocationUpdate[]` |

**Total: 36 endpoints** (27 GET, 5 POST, 3 DELETE, 1 PATCH)

---

## Testing

```bash
# Run all 1,319 tests
pnpm test

# Backend only (664 tests, 49 suites)
pnpm --filter @sharkpark/backend test

# Mobile only (655 tests, 54 suites)
pnpm --filter mobile test

# Backend E2E (requires running DB)
pnpm --filter @sharkpark/backend test:e2e
```

---

## Environment Variables

Canonical reference: [`apps/backend/.env.example`](apps/backend/.env.example). The most important variables:

| Variable | Required? | Description |
|----------|-----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string. Local: Docker. Prod: Neon **pooled** endpoint (`-pooler.`) with `pgbouncer=true&connection_limit=1`. |
| `DATABASE_URL_RO` | No | Optional read-replica URL (Neon read branch). Falls back to `DATABASE_URL`. |
| `AZURE_TENANT_ID` | Yes (prod) | Azure AD tenant for SSO. |
| `AZURE_CLIENT_ID` | Yes (prod) | Azure AD application (client) ID. |
| `DEVICE_HASH_SALT` | Yes | Salt used to hash device IDs before persistence. Generate with `openssl rand -hex 32`. |
| `DEVICE_EVENT_SECRET` | Yes | HMAC-SHA256 secret used by mobile to sign occupancy events. Must match the value baked into the mobile build. |
| `WS_CONNECT_SECRET` | Yes (prod) | Shared secret for the shuttle WebSocket handshake. Must match the mobile build. |
| `REDIS_URL` | Yes (prod) | Fly Redis / Upstash URL. Required for multi-instance prod; falls back to in-memory cache when unset. |
| `SENTRY_DSN` | Recommended | Backend Sentry project DSN. When unset, Sentry init is a no-op. |
| `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` | No | Stamped on every event/check-in. Set automatically by `deploy.yml`. |
| `LOG_LEVEL` | No | pino level: `trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`. Defaults to `debug` (dev), `info` (prod). |
| `WEATHER_USER_AGENT` / `WEATHER_LAT` / `WEATHER_LON` | No | NWS api.weather.gov client identification + campus coordinates. Defaults provided. |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Recommended | Firebase Cloud Messaging service-account credentials. When unset, push delivery is disabled (logged as a warning). |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `S3_ENDPOINT` | Yes (prod) | S3-compatible storage. Local: MinIO. Prod: Cloudflare R2. Used by backup and ML-export jobs. |
| `PORT` / `HOST` | No | API server bind address. Defaults `0.0.0.0:3000`. |
| `NODE_ENV` | No | `development` \| `production` \| `test`. |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated allow-list. Dev allows all origins. |

---

## Docker Services

Defined in `docker/docker-compose.yml`:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `postgres` | `postgres:17-alpine` | `5433 -> 5432` | Local dev database (Neon Postgres 17 in production) |
| `minio` | `minio/minio:latest` | `9000` (S3 API), `9001` (console) | Local S3-compatible object storage (Cloudflare R2 in production) |
| `minio-init` | `minio/mc:latest` | — | One-shot bucket bootstrap (`sharkpark-backups`, `sharkpark-ml-exports`) |

```bash
# Containers start automatically on pnpm install.
# To manage manually:
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml down
```

---

## Project Structure

```
SharkPark/
├── apps/
│   ├── backend/                  # NestJS API
│   │   ├── prisma/               # Schema, migrations, seed data
│   │   ├── src/
│   │   │   ├── auth/             # Azure AD JWT strategy (Passport)
│   │   │   ├── common/           # Global exception filters
│   │   │   ├── config/           # Typed config modules + validation
│   │   │   ├── database/         # Prisma module (connection pooling, env config)
│   │   │   ├── events/           # Campus events and parking impact (incl. scrapers)
│   │   │   ├── health/           # /health/live + /health/ready probes
│   │   │   ├── lots/             # Parking lot CRUD, filtering, occupancy summaries
│   │   │   ├── notifications/    # Expo push notifications + user preference fan-out
│   │   │   ├── occupancy-events/ # Geofence event pipeline, dedup, snapshots
│   │   │   ├── redis/            # Global ioredis cache module (shared shuttle state)
│   │   │   ├── reliability/      # Multi-factor weighted reliability scoring
│   │   │   ├── reports/          # User-submitted lot status reports
│   │   │   ├── scheduler/        # Standalone cron process: 29 @nestjs/schedule jobs
│   │   │   ├── shuttle-tracker/  # Live shuttle tracking (PassioGO WS + socket.io gateway)
│   │   │   ├── users/            # Profiles, favorites, notification preferences
│   │   │   ├── weather/          # Weather data for demand correlation
│   │   │   ├── main.ts           # HTTP app entry (Fly `app` process)
│   │   │   └── scheduler-main.ts # Cron entry (Fly `cron` process, no HTTP)
│   │   └── test/                 # E2E tests
│   │
│   └── mobile/                   # React Native app
│       ├── src/
│       │   ├── auth/             # Azure AD SSO (react-native-app-auth)
│       │   ├── components/       # UI components (Header, Modals, Charts, etc.)
│       │   ├── constants/        # Theme, geofencing config, campus coordinates
│       │   ├── context/          # Auth, Geofencing, Theme providers
│       │   ├── data/             # Mock data for offline development
│       │   ├── hooks/            # Custom hooks (lots, location, reliability)
│       │   ├── navigation/       # React Navigation tab navigator
│       │   ├── screens/          # Map, Forecast, Profile, Login, Verification
│       │   ├── services/         # API client layer and location services
│       │   ├── types/            # TypeScript type definitions
│       │   └── utils/            # Geofencing (ray casting), map, parking utilities
│       └── __tests__/            # Unit tests
│
├── packages/
│   ├── types/                    # Shared TypeScript types
│   └── utils/                    # Shared utility functions
│
├── docker/                       # Docker Compose configuration
├── docs/                         # Project documentation
├── infrastructure/               # Fly.io / Neon / R2 deployment notes (see infrastructure/README.md)
├── scripts/                      # Dev scripts (start-local, network IP)
└── services/
    └── ml/                       # ML prediction service (training pipeline + MLflow exports)
```

---

## CI / CD

GitHub Actions workflows live under `.github/workflows/`:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Every push and PR | Install (`SKIP_LOCAL_INFRA=1`) → lint → typecheck → test → build. |
| `deploy.yml` | Push to `main` | Install → `prisma generate` → `prisma migrate deploy` → **`pnpm db:seed:prod`** (idempotent reference data) → Sentry release + sourcemap upload → `flyctl deploy` (rolling, gated by `/health/ready`). Secrets: `NEON_DATABASE_URL`, `FLY_API_TOKEN`, `SENTRY_AUTH_TOKEN`. |
| `deploy-marketing.yml` | Push to `main` (marketing site changes) | Builds & deploys the marketing site. |
| `seed-prod-lots.yml` | Manual `workflow_dispatch` | One-shot helper to re-seed reference lot data outside the normal deploy flow. |
| `restore-test.yml` | Nightly schedule | Restores the latest R2 backup to a throwaway DB and runs schema/row-count assertions. |
| `neon_workflow.yml` | PR open/sync, merge, close | Spins up an ephemeral Neon branch per PR for isolated preview/testing; tears it down on close. |

---

## Seed Data

There are two seed scripts with different responsibilities:

- **`pnpm db:seed`** — full local development seed (`apps/backend/prisma/seed.ts`). Wipes and re-creates a complete demo dataset:
  - **28 parking lots** — G1–G14, E1–E11, PVN, PVS, PYR (student and employee lots with permit types, capacities, polygon coordinates, and metadata)
  - **5 users** with varied notification preferences and 14 favorite lot assignments
  - **4 campus events** (athletic, academic) with 16 parking impact records across nearby lots
  - **Weather records** for demand correlation features
  - **~2,240 occupancy snapshots** (hourly data for each lot, used as ML training data)
  - **~293 occupancy events** (anonymous geofencing enter/exit events)
  - **10 device state records** (for deduplication testing)

- **`pnpm db:seed:prod`** — production reference-data seed (`apps/backend/prisma/seed-prod.ts`). Fully idempotent (upsert-only, never deletes user data, intentionally excludes `current_occupancy` from updates). Runs automatically on every `deploy.yml` invocation after migrations and provisions the canonical lot catalog so production never starts empty.

---

## License

UNLICENSED — private project.