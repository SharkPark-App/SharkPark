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
| **Database** | PostgreSQL 16 (local) / Aurora PostgreSQL (production) | Relational model fits our domain well (lots have many snapshots, users have many favorites, events impact multiple lots). We run standard PostgreSQL 16 in Docker for local development. In production we deploy to Amazon Aurora PostgreSQL Serverless v2, which is wire-compatible with PostgreSQL but adds auto-scaling, automated backups, and multi-AZ replication. The only change between environments is the `DATABASE_URL` connection string. |
| **Security** | Helmet, Throttler, CORS, Passport JWT | Helmet sets security HTTP headers. The throttler rate-limits to 20 requests per 10 seconds per IP. CORS is locked down in production. Passport validates Azure AD JWTs against Microsoft's JWKS endpoint with automatic key rotation. |
| **Monorepo** | pnpm 10 workspaces + Turborepo | pnpm's strict dependency resolution prevents phantom dependencies. Turborepo parallelizes builds, tests, and lints across workspaces with caching. Shared packages (`packages/types`, `packages/utils`) are consumed by both the backend and mobile app. |
| **Infra** | Docker Compose | Single `docker compose up` gives every developer an identical PostgreSQL + LocalStack (S3) environment. The postinstall script automates this so `pnpm install` is the only command needed. |

---

## Architecture

```
┌──────────────────┐         ┌──────────────────────┐
│  React Native    │  REST   │  NestJS API          │
│  iOS / Android   │ ──────> │  /api/v1/*           │
│  (apps/mobile)   │         │  (apps/backend)      │
└──────────────────┘         └────────┬─────────────┘
                                      │ Prisma ORM
                              ┌───────▼───────┐
                              │  PostgreSQL   │
                              │  (Docker dev) │
                              │  (Aurora prod)│
                              └───────────────┘
```

The backend is organized into feature modules, each with its own controller, service, and interfaces:

- **Lots** — CRUD for parking lots, occupancy summaries, historical snapshots, and filtering by type/permit/availability.
- **Users** — Profile management, favorite lots, notification preferences. All endpoints are guarded by Azure AD authentication.
- **Events** — Campus events (athletic games, graduation, etc.) and their predicted parking impact on nearby lots.
- **Occupancy Events** — The core data pipeline: receives anonymous geofence ENTER/EXIT events, deduplicates, updates occupancy atomically, and produces periodic snapshots for ML training.
- **Reliability** — Real-time confidence scoring for each lot's occupancy estimate, computed from the five-factor weighted model described above.
- **Weather** — Current weather data used as an ML feature (rain correlates with higher driving and lot demand).
- **Database** — Global Prisma module with environment-aware connection pooling (pool size 5 locally, 20 in production, SSL required in production).

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

### Client-side forecasting

Short-term forecasts are generated on the mobile device using a time-of-day heuristic (peak multipliers for 8-10 AM and 5-7 PM, low multipliers for 10 PM-6 AM) applied to the current occupancy rate. Confidence margins are wider for lots with lower reliability scores. This runs client-side so forecasts work even when offline. The ML service (`services/ml/`) will eventually replace this with trained models backed by the snapshot data.

### Multi-tenant schema

The database schema is designed around a `School` entity as the top-level tenant. Every lot, user, event, and calendar entry belongs to a school. While we currently only support CSULB, this means the system can be deployed to other universities without schema changes — just add a new school and its associated lot data.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 20 |
| pnpm | 10.20.0 (`corepack enable && corepack prepare pnpm@10.20.0 --activate`) |
| Docker | Latest (for PostgreSQL + LocalStack) |
| Xcode | 16+ (iOS builds, includes CocoaPods via `xcode-select`) |
| CocoaPods | Installed via Xcode or `gem install cocoapods` |

---

## Getting Started

```bash
# 1. Clone and install (Docker, migrations, and seeding run automatically via postinstall)
git clone <repo-url> && cd SharkPark
pnpm install

# 2. Set up environment
cp .env.example apps/backend/.env
# Edit apps/backend/.env with your values (see Environment Variables below)

# 3. Start the backend (http://localhost:3000)
pnpm --filter @sharkpark/backend dev

# 4. Start the mobile app (in a second terminal)
pnpm --filter mobile ios
```

Run `pnpm dev` from root to start both backend and mobile in parallel.

**What happens on `pnpm install`?** The postinstall script automatically starts Docker containers, waits for PostgreSQL to accept connections, runs Prisma migrations (idempotent, safe to re-run), generates the Prisma client, and seeds the database if it is empty. Set `SKIP_LOCAL_INFRA=1` to skip all of this (used in CI).

---

## Scripts Reference

### Root (monorepo)

| Script | Command | Description |
|--------|---------|-------------|
| `pnpm install` | — | Install all deps, start Docker, migrate, and seed |
| `pnpm dev` | `turbo run dev --parallel` | Start backend + mobile in parallel |
| `pnpm build` | `turbo run build` | Build all workspaces |
| `pnpm test` | `turbo run test` | Run all tests across workspaces |
| `pnpm lint` | `turbo run lint` | Lint all workspaces |
| `pnpm typecheck` | `turbo run typecheck` | Type-check all workspaces |
| `pnpm format` | `prettier . --check` | Check formatting |
| `pnpm format:fix` | `prettier . --write` | Fix formatting |
| `pnpm db:setup` | `prisma migrate dev` | Create/update database schema |
| `pnpm db:seed` | `prisma db seed` | Seed database (28 lots, users, events, etc.) |
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
| `pnpm test` | `jest` | Run 142 unit tests (17 suites) |
| `pnpm test:e2e` | `jest --config jest-e2e.js` | Run E2E tests |
| `pnpm lint` | `eslint .` | Lint backend source |
| `pnpm typecheck` | `tsc --noEmit` | Type-check without emitting |

### Mobile (`apps/mobile`)

| Script | Command | Description |
|--------|---------|-------------|
| `pnpm ios` | `react-native run-ios` | Build and run on iOS simulator |
| `pnpm android` | `react-native run-android` | Build and run on Android emulator |
| `pnpm start` | `react-native start` | Start Metro bundler |
| `pnpm test` | `jest` | Run 106 unit tests (13 suites) |
| `pnpm lint` | `eslint .` | Lint mobile source |
| `pnpm typecheck` | `tsc --noEmit` | Type-check without emitting |

---

## API Endpoints

All endpoints are prefixed with `/api/v1`. The backend runs on port 3000 by default.

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/` | Health check (returns status, timestamp, database connectivity) |

### Lots

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/lots` | List all parking lots (filterable by `type`, `available`, `minCapacity`, `maxCapacity`, `search`, `favorite`) |
| `GET` | `/api/v1/lots/summary` | Campus-wide occupancy summary |
| `GET` | `/api/v1/lots/:id` | Get a single lot by ID |
| `GET` | `/api/v1/lots/:id/history` | Historical occupancy (`from`, `to` query params) |

### Users (authenticated)

All user endpoints require Azure AD authentication.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/users/:userId` | Get user profile |
| `GET` | `/api/v1/users/:userId/favorites` | List favorite lots |
| `POST` | `/api/v1/users/:userId/favorites` | Add a lot to favorites |
| `DELETE` | `/api/v1/users/:userId/favorites/:lotId` | Remove a favorite lot |
| `PATCH` | `/api/v1/users/:userId/notifications` | Update notification preferences |

### Events

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/events` | List campus events (optional `date` filter) |
| `GET` | `/api/v1/events/:id/parking-impact` | Parking impact for a specific event |

### Weather

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/weather/current` | Current weather data for parking demand correlation |

### Occupancy Events

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/occupancy-events` | Record anonymous geofencing ENTER/EXIT event |
| `GET` | `/api/v1/occupancy-events/lot/:lotId` | Events for a lot in a date range (`from`, `to`, `type`) |
| `GET` | `/api/v1/occupancy-events/lot/:lotId/stats` | Enter/exit counts for a lot (`from`, `to`) |
| `POST` | `/api/v1/occupancy-events/snapshots/trigger` | Manually trigger occupancy snapshot |
| `GET` | `/api/v1/occupancy-events/lot/:lotId/snapshots` | Snapshots for a lot on a date (`date`, `lotId`) |

### Reliability

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/reliability/:lotId` | Reliability score for a specific lot |
| `GET` | `/api/v1/reliability` | Reliability scores for all lots |
| `GET` | `/api/v1/reliability/config` | Reliability computation config (weights and thresholds) |

**Total: 19 endpoints** (14 GET, 3 POST, 1 DELETE, 1 PATCH)

---

## Testing

```bash
# Run all 248 tests
pnpm test

# Backend only (142 tests, 17 suites)
pnpm --filter @sharkpark/backend test

# Mobile only (106 tests, 13 suites)
pnpm --filter mobile test

# Backend E2E (requires running DB)
pnpm --filter @sharkpark/backend test:e2e
```

---

## Environment Variables

Create `apps/backend/.env` from `.env.example`:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string (local Docker or Aurora endpoint) | `postgresql://sharkpark:sharkpark@localhost:5433/sharkpark` |
| `PORT` | API server port | `3000` |
| `NODE_ENV` | Environment (`development` / `production`) | `development` |
| `AZURE_TENANT_ID` | Azure AD tenant for SSO | — |
| `AZURE_CLIENT_ID` | Azure AD application (client) ID | — |
| `CORS_ORIGIN` | Allowed CORS origin (comma-separated in production) | `*` |
| `THROTTLE_TTL` | Rate limit window (seconds) | `10` |
| `THROTTLE_LIMIT` | Max requests per window | `20` |

---

## Docker Services

Defined in `docker/docker-compose.yml`:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `postgres` | `postgres:16-alpine` | `5433 -> 5432` | Local dev database (Aurora PostgreSQL in production) |
| `localstack` | `localstack/localstack` | `4566` | Local S3 emulation |

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
│   │   │   ├── database/         # Prisma module (connection pooling, env config)
│   │   │   ├── events/           # Campus events and parking impact
│   │   │   ├── lots/             # Parking lot CRUD, filtering, occupancy summaries
│   │   │   ├── occupancy-events/ # Geofence event pipeline, dedup, snapshots, scheduler
│   │   │   ├── reliability/      # Multi-factor weighted reliability scoring
│   │   │   ├── users/            # Profiles, favorites, notification preferences
│   │   │   └── weather/          # Weather data for demand correlation
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
├── infrastructure/               # Deployment infrastructure (planned)
├── scripts/                      # Dev scripts (start-local, network IP)
└── services/
    └── ml/                       # ML prediction service (planned)
```

---

## CI / CD

GitHub Actions workflow at `.github/workflows/ci.yml` runs on every push and PR:

1. Install dependencies (`pnpm install` with `SKIP_LOCAL_INFRA=1`)
2. Lint (`pnpm lint`)
3. Type-check (`pnpm typecheck`)
4. Test (`pnpm test`)
5. Build (`pnpm build`)

---

## Seed Data

The database seed (`pnpm db:seed`) provisions:

- **28 parking lots** — G1-G14, E1-E11, PVN, PVS, PYR (student and employee lots with permit types, capacities, polygon coordinates, and metadata)
- **5 users** with varied notification preferences and 14 favorite lot assignments
- **4 campus events** (athletic, academic) with 16 parking impact records across nearby lots
- **Weather records** for demand correlation features
- **~2,240 occupancy snapshots** (hourly data for each lot, used as ML training data)
- **~293 occupancy events** (anonymous geofencing enter/exit events)
- **10 device state records** (for deduplication testing)

---

## License

UNLICENSED — private project.