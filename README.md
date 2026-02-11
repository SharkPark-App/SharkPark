# SharkPark Monorepo - Local Dev Guide

This repo contains backend (NestJS), mobile (React Native), ML (planned), and shared packages in a single PNPM/Turbo monorepo.

- Root: `pnpm` workspaces + `turbo`
- Backend: `apps/backend` (Nest 11, TS, Jest)
- Mobile: `apps/mobile` (React Native CLI)
- Shared: `packages/types`, `packages/utils`
- ML/service layer (planned): `services/ml/`
- Local infra: DynamoDB Local + LocalStack (S3) via `./scripts/start-local.sh`

---

* [SharkPark Monorepo — Local Dev Guide](#sharkpark-monorepo--local-dev-guide)

  * [Tech choices](#tech-choices)
  * [Prerequisites](#prerequisites)
  * [Clone and install](#clone-and-install)
  * [Local infra (DynamoDB + LocalStack)](#local-infra-dynamodb--localstack)
  * [Build / lint / typecheck (root)](#build--lint--typecheck-root)
  * [Run the backend (NestJS)](#run-the-backend-nestjs)
  * [Run tests (backend)](#run-tests-backend)
  * [Run the mobile app](#run-the-mobile-app)
  * [services/ml (planned)](#servicesml-planned)
  * [File / workspace layout](#file--workspace-layout)
  * [CI (GitHub Actions)](#ci-github-actions)
  * [Env / secrets](#env--secrets)
  * [Deployment (later)](#deployment-later)
  * [Local quickstart](#local-quickstart)

---

## Tech choices

**PNPM + Turbo**  
One workspace to install once and build/lint/test all apps. Turbo lets the CI reuse builds and run tasks per package.

**NestJS (backend)**  
Opinionated, modular, TS-first, easy testing, and easy to add Swagger, auth, and modules.

**React Native CLI (mobile)**  
Full control over native iOS/Android, good for geofencing and background location.

**Shared packages (`packages/types`, `packages/utils`)**  
Single source of truth for contracts between mobile and backend.

**Local infra (DynamoDB Local + LocalStack)**  
Local DB and S3 so no one needs real AWS creds to run the app.

**CI (GitHub Actions)**  
Runs build, lint, typecheck, and backend tests on every push/PR. No deploy in CI.

**services/ml (planned)**  
Keeps ML / AI code separate from Nest and RN. Lets us use heavier deps (PyTorch, transformers, or TS-based inference) without polluting the Node apps, and makes it easy to run ML as its own container.

---

## Prerequisites

- Node: v22.x
- pnpm: `pnpm@10.20.0`
- Docker running
- Xcode (for iOS) or Android Studio (for Android)
- Git

Optional for iOS:
```bash
xcode-select --switch /Applications/Xcode.app
````

---

## Clone and install

```bash
git clone <repo-url> SharkPark
cd SharkPark
pnpm install
```

If you don’t want local infra to start during install (CI, or no Docker):

```bash
SKIP_LOCAL_INFRA=1 pnpm install
```

---

## Local infra (DynamoDB + LocalStack)

```bash
./scripts/start-local.sh
```

This starts:

* `sharkpark-dynamodb` on `8000`
* `sharkpark-localstack` on `4566`

To skip:

```bash
SKIP_LOCAL_INFRA=1 pnpm install
SKIP_LOCAL_INFRA=1 pnpm build
```

In CI:

```yaml
env:
  SKIP_LOCAL_INFRA: "1"
```

---

## Build / lint / typecheck (root)

```bash
pnpm build
pnpm lint
pnpm typecheck
```

---

## Run the backend (NestJS)

**Setup database first (one-time):**
```bash
pnpm db:setup    # Creates DynamoDB tables
pnpm db:seed     # Seeds test data (28 lots, 5 users, 4 events, weather)
```

**Start the server:**
```bash
cd apps/backend
pnpm dev
```

API base URL: `http://localhost:3000/api/v1`

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/lots` | Get all parking lots (supports query filters) |
| GET | `/lots/summary` | Campus-wide occupancy summary |
| GET | `/lots/:id` | Get specific lot |
| GET | `/lots/:id/history` | Historical occupancy data |
| GET | `/users/:userId` | Get user profile |
| GET | `/users/:userId/favorites` | Get user's favorite lots |
| POST | `/users/:userId/favorites/:lotId` | Add to favorites |
| DELETE | `/users/:userId/favorites/:lotId` | Remove from favorites |
| PATCH | `/users/:userId/notifications` | Update notification preferences |
| GET | `/events` | Get campus events |
| GET | `/events/:eventId/impacts` | Get event parking impacts |
| GET | `/weather/current` | Get current weather |

---

## Run tests (backend)

From root:

```bash
pnpm -C apps/backend test       # 41 unit tests
pnpm -C apps/backend test:e2e   # 27 E2E tests
```

Or inside backend:

```bash
cd apps/backend
pnpm test
pnpm test:e2e
```

Unit tests cover all services and controllers. E2E tests hit real DynamoDB Local.

---

## Run the mobile app

```bash
cd apps/mobile
pnpm install
pnpm ios
# or
pnpm android
```

If you see the `xcodebuild ... requires Xcode` error:

```bash
sudo xcode-select --switch /Applications/Xcode.app
```

RN config files (`metro.config.js`, `babel.config.js`) stay CommonJS so `require(...)` works.

---

## services/ml (planned)

Path: `services/ml/`

Purpose:

* isolate ML/AI logic from Nest and RN
* keep heavy deps (Python or TS ML) out of the app packages
* let backend/mobile call ML over HTTP/gRPC

What goes here:

* model / inference code
* HTTP wrapper (e.g. `/predict`)
* Dockerfile for ML service
* unit tests / sample payloads

Local shape (TS example):

```bash
cd services/ml
pnpm install
pnpm dev
# service on http://localhost:8001
```

Backend → ML:

* backend calls `http://localhost:8001/predict` in local dev
* in real deployment this becomes an internal URL (ECS/K8s)
* keeps versioning of ML independent from Nest

---

## File / workspace layout

```text
SharkPark/                      # monorepo root
├── package.json                # root scripts + dev deps (turbo, husky, prettier, etc.)
├── pnpm-workspace.yaml         # tells pnpm which folders are part of the workspace
├── turbo.json                  # defines shared build/lint/typecheck pipelines across apps
├── tsconfig.json               # root TS config (extends tsconfig.base.json)
├── tsconfig.base.json          # shared TS settings for all packages
├── eslint.config.mjs           # shared lint rules for all packages/apps
├── .prettierrc                 # code formatting rules
├── .prettierignore             # files to skip formatting
├── .husky/                     # git hooks (pre-commit runs lint + typecheck)
│   └── pre-commit
├── scripts/                    # helper shell scripts for local/dev ops
│   ├── start-local.sh          # spins up local infra (dynamodb-local, localstack)
│   ├── setup-dynamodb-schema.ts # creates DynamoDB tables with indexes
│   └── seed-database.ts        # seeds test data (lots, users, events, weather)
├── docker/                     # local development infrastructure
│   └── docker-compose.yml      # DynamoDB Local + LocalStack (S3)
├── infrastructure/             # AWS deployment code (CDK/SST - planned)
│   └── README.md
├── apps/                       # runnable applications (what we actually ship)
│   ├── backend/                # NestJS API server (parking data, auth, events)
│   │   ├── src/                # backend source code
│   │   │   ├── main.ts         # NestJS entrypoint / bootstrap
│   │   │   ├── app.module.ts   # root module, imports feature modules
│   │   │   ├── app.controller.ts # health check endpoint
│   │   │   ├── app.service.ts  # health check service
│   │   │   ├── constants.ts    # API prefix, service name
│   │   │   ├── database/       # DynamoDB client module
│   │   │   ├── lots/           # parking lots (service, controller, interfaces)
│   │   │   ├── users/          # users and favorites
│   │   │   ├── events/         # campus events
│   │   │   ├── weather/        # weather data
│   │   │   └── common/         # shared filters, guards
│   │   ├── test/               # E2E tests (27 tests across 5 suites)
│   │   ├── dist/               # compiled output (gitignored)
│   │   ├── tsconfig.json       # backend-specific TS settings (extends root)
│   │   ├── tsconfig.build.json # TS build target for NestJS
│   │   ├── jest.config.js      # Jest config for unit tests
│   │   ├── jest-e2e.js         # Jest config for e2e tests
│   │   ├── eslint.config.mjs   # backend-specific lint rules
│   │   └── package.json        # backend app deps/scripts
│   └── mobile/                 # React Native app (iOS/Android client)
│       ├── App.tsx             # RN root component (entry point)
│       ├── android/            # Android native project (auto-generated, rarely edited)
│       ├── ios/                # iOS native project (auto-generated, rarely edited)
│       ├── __tests__/          # mobile app tests
│       ├── metro.config.js     # RN bundler config
│       ├── babel.config.js     # RN/Babel transforms
│       ├── eslint.config.mjs   # mobile-specific lint rules
│       ├── tsconfig.json       # mobile TS config
│       └── package.json        # mobile app deps/scripts
├── services/                   # non-Node services / background jobs
│   └── ml/                     # future ML/inference/training code (Python/TS)
│                               # will run as separate service with own Dockerfile
└── packages/                   # shared, versioned libraries for the monorepo
    ├── types/                  # shared TypeScript types
    │   ├── src/
    │   │   └── index.ts        # ParkingLot, OccupancyEvent, Forecast types
    │   ├── dist/               # compiled declarations (gitignored)
    │   ├── tsconfig.json       # types package TS config
    │   └── package.json        # @sharkpark/types
    └── utils/                  # shared helper functions
        ├── src/
        │   └── index.ts        # isoNow(), toOccupancyBucket(), normalizeEmail()
        ├── dist/               # compiled code (gitignored)
        ├── tsconfig.json       # utils package TS config
        └── package.json        # @sharkpark/utils
```

---

## CI (GitHub Actions)

```yaml
name: CI
on: [push, pull_request]

jobs:
  ci:
    runs-on: ubuntu-latest
    env:
      SKIP_LOCAL_INFRA: "1"
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.20.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install deps
        run: pnpm install

      - name: Build
        run: pnpm build

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Backend unit tests
        run: pnpm -C apps/backend test

      - name: Backend e2e tests
        run: pnpm -C apps/backend test:e2e
```

What it does:

* installs
* builds all workspaces
* lints
* typechecks
* runs backend unit + e2e tests
* does not start Docker
* does not deploy

---

## Env / secrets

Local:

```bash
cp .env.example .env.local
```

Put AWS, DB, and service creds in `.env.local`. Do not commit it.

Nest loads env via `@nestjs/config`.

CI: add secrets in GitHub → Actions → Repository secrets.

---

## Deployment (later)

* build Docker for `apps/backend`
* push to registry
* deploy to ECS/Lambda/K8s
* mobile is shipped separately (Expo/EAS or native)
* CI stays as quality gate

`services/ml` can be built and deployed as a separate image, versioned independently.

---

## Local quickstart

```bash
# 1. Install dependencies (also starts Docker containers)
pnpm install

# 2. Setup and seed database (one-time)
pnpm db:setup
pnpm db:seed

# 3. Verify everything builds
pnpm build
pnpm lint
pnpm typecheck

# 4. Run backend
cd apps/backend
pnpm dev
# API at http://localhost:3000/api/v1

# 5. Run mobile (new terminal)
cd apps/mobile
pnpm ios   # or pnpm android
```

If Docker containers stopped, restart them:
```bash
./scripts/start-local.sh
```
