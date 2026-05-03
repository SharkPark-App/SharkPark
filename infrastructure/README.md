# SharkPark Infrastructure

AWS serverless architecture with **Aurora PostgreSQL Serverless v2** as the primary datastore. Tiered approach: start lean, scale when needed.

---

## Decision Record (Feb 2026): Aurora PostgreSQL

**Decision:** Migrated from DynamoDB to Aurora PostgreSQL Serverless v2.

**Evaluated:** DynamoDB, Supabase (hosted PostgreSQL), standard RDS PostgreSQL, Aurora PostgreSQL.

**Context:** SharkPark is a real-time parking companion app with ML-powered occupancy forecasting (XGBoost/LightGBM). The app collects anonymous geofence-triggered ENTER/EXIT events from mobile devices, aggregates them into occupancy snapshots every 15 minutes, and uses those snapshots to train short-term (hourly) and long-term (7-day) prediction models. We currently serve 28 lots for ~30,000 CSULB commuters, with plans to scale to other campuses.

### Why Aurora PostgreSQL

1. **ML training queries are native SQL.** Our XGBoost models require 4-week rolling averages grouped by `(lot_id, day_of_week, hour)`, JOINs with academic calendar data, and feature extraction across multiple tables. In PostgreSQL, these are single queries. In DynamoDB, they required a full S3 export pipeline (DynamoDB → S3 → Parquet → Glue/Athena → SageMaker).

2. **Our data is inherently relational.** Lots → occupancy events → snapshots → predictions → users → favorites → campus events → academic calendar. Every service in our backend (`LotsService`, `UsersService`, `OccupancyEventsService`, `ReliabilityComputationService`) performs cross-entity queries that DynamoDB handles through app-side joins and multiple round-trips.

3. **ACID transactions for occupancy accuracy.** Geofence events from phones can be duplicated (GPS bounce), delayed (garage signal loss), or missed entirely (app killed by OS). Our deduplication logic (`checkDuplicate()`) and atomic occupancy counter updates (`updateLotOccupancy()`) benefit from PostgreSQL's transactional guarantees.

4. **Our write volume is modest.** ~4 writes/second at peak (30K students arriving over 2 hours). DynamoDB's infinite write scaling isn't needed — PostgreSQL handles tens of thousands of writes/second.

5. **Aurora Serverless v2 fits our usage pattern.** Campus parking is dead 10 PM–6 AM and during breaks/summer. Serverless v2 scales down to 0.5 ACU during off-hours and scales up during the 8–9 AM rush. We only pay for what we use.

6. **No S3 export pipeline needed.** DynamoDB's 90-day TTL on our timeseries table forced us to architect a daily S3 archive job to preserve ML training data. With PostgreSQL, snapshots are permanently queryable — the entire pipeline disappears.

### Why Not the Alternatives

| Option | Why Not |
|--------|--------|
| **DynamoDB** | ML training queries require expensive scans + app-side aggregation. S3 export pipeline adds a whole service just to compensate for TTL data loss. App-side filtering in `LotsService.findAll()` wastes read capacity. Multi-query reliability computation (`ReliabilityComputationService`) is slow when it should be one SQL aggregation. |
| **Supabase** | Good PostgreSQL host, but adds vendor dependency on a startup. Aurora offers the same PostgreSQL engine with AWS-native integration (RDS Proxy, IAM auth, CDK automation) and a 30-year engine track record. Scored 4.1/5 vs Aurora's 4.4/5 on our weighted evaluation. |
| **Standard RDS PostgreSQL** | No auto-scaling — requires manual instance sizing and capacity planning. Aurora Serverless v2 scales automatically for our bursty campus traffic pattern. |
| **Aurora ML (SQL → SageMaker)** | Designed for per-row real-time inference (`SELECT predict(col) FROM table`). Our models run as batch jobs every 15 min / daily — not per-query. Standard Lambda-based inference is simpler and cheaper. |

### What We Keep from DynamoDB Design

- ✅ Single-table `current_occupancy` counter on lots (fast reads, atomic increments)
- ✅ Device hash deduplication for geofence events
- ✅ 30-day retention for raw events (scheduled `DELETE` instead of TTL)
- ✅ 15-minute snapshot aggregation schedule (via `@nestjs/schedule` cron)
- ✅ Privacy-first approach (SHA-256 device hashing, no PII in events)

---

## Deployment Tiers

| Tier | When to Use | Monthly Cost | Services |
|------|-------------|--------------|----------|
| **Tier 1: Launch** | 0-1,000 users | $15-30 | Lambda, API Gateway, Aurora PostgreSQL |
| **Tier 2: Growth** | 1,000-10,000 users | $40-80 | + CloudFront, S3, Read Replicas |
| **Tier 3: Scale** | 10,000+ users / Multi-school | $100-200+ | + ElastiCache, WAF, X-Ray |

**Start with Tier 1. Add services only when you see the need.**

---

## Tier 1: Launch Architecture (Recommended Start)

Minimal viable infrastructure with a proper relational database.

```
┌──────────────┐         ┌─────────────────────────┐         ┌──────────────────────┐
│  Mobile App  │ ──────► │     API Gateway         │ ──────► │   Lambda (NestJS)    │
│  (iOS/Android)│        │  - HTTPS/TLS            │         │   - Single function  │
└──────────────┘         │  - Basic rate limiting  │         │   - All routes       │
                         └─────────────────────────┘         └──────────┬───────────┘
                                                                        │
                                                                   RDS Proxy
                                                               (connection pooling)
                                                                        │
                                                                        ▼
                                                             ┌──────────────────────┐
                                                             │  Aurora PostgreSQL   │
                                                             │  (Serverless v2)     │
                                                             │  - Auto-scales 0.5→8 │
                                                             │    ACU               │
                                                             │  - sharkpark DB      │
                                                             └──────────────────────┘
                                                                        │
                                                                  Azure AD
                                                              (CSULB SSO - free)
```

### Tier 1 Services

| Service | Purpose | Free Tier | After Free Tier |
|---------|---------|-----------|-----------------|
| **Lambda** | API handlers | 1M requests/month | ~$0.20/1M requests |
| **API Gateway** | REST API | 1M requests/month | ~$3.50/1M requests |
| **Aurora Serverless v2** | Database | None (12-mo RDS free tier for t3.micro) | ~$15-25/mo at min ACU |
| **RDS Proxy** | Connection pooling | Included with RDS | ~$0 extra |
| **CloudWatch** | Logs | 5GB logs/month | ~$0.50/GB |

**Estimated cost: $15-30/month**

### What You Get
- ✅ Full SQL — JOINs, window functions, aggregations for ML
- ✅ PostGIS — Geospatial queries ready when needed
- ✅ Foreign keys & constraints — Data integrity enforced at DB level
- ✅ Auto-scaling — Aurora Serverless v2 scales compute automatically
- ✅ Connection pooling — RDS Proxy handles Lambda concurrency
- ✅ HTTPS/SSL included
- ✅ Automated daily backups (35-day retention)

### What You Don't Get (Yet)
- ❌ Edge caching (add CloudFront in Tier 2)
- ❌ Read replicas (add in Tier 2 for read-heavy multi-school)
- ❌ Sub-millisecond caching (add ElastiCache in Tier 3)
- ❌ Advanced DDoS protection (add WAF in Tier 3)

---

## Tier 2: Growth Architecture

Add when you have **consistent traffic**, **multiple schools**, or **need caching**.

```
                         ┌─────────────────────────┐
                         │      CloudFront CDN     │ ◄── Cache lot data, predictions
                         │  - Edge caching         │
                         │  - Basic DDoS protection│
                         └───────────┬─────────────┘
                                     │
┌──────────────┐         ┌───────────▼─────────────┐         ┌──────────────────────┐
│  Mobile App  │ ──────► │     API Gateway         │ ──────► │   Lambda (NestJS)    │
└──────────────┘         └─────────────────────────┘         └──────────┬───────────┘
                                                                        │
                                                                   RDS Proxy
                                                                        │
                                                    ┌───────────────────┼───────────────────┐
                                                    │                   │                   │
                                         ┌──────────▼──────┐  ┌─────────▼─────────┐  ┌──────▼──────┐
                                         │     Aurora      │  │    S3 Bucket      │  │  Azure AD   │
                                         │   PostgreSQL    │  │  - ML model       │  │  (Auth)     │
                                         │  + Read Replica │  │    artifacts      │  └─────────────┘
                                         └─────────────────┘  │  - Long-term data │
                                                              │    archive        │
                                                              └───────────────────┘
```

### Added in Tier 2

| Service | Purpose | Monthly Cost |
|---------|---------|--------------|
| **CloudFront** | CDN + edge caching | ~$1-5 |
| **S3** | ML model artifacts + data archive | ~$1-3 |
| **Aurora Read Replica** | Offload ML training queries | ~$15-25 |

**Estimated cost: $40-80/month**

### When to Upgrade to Tier 2
- Adding a second school
- ML training queries slowing down operational reads
- Response times > 200ms for cached data
- Want basic DDoS protection

---

## Tier 3: Scale Architecture

Add when you have **thousands of daily users across multiple schools**.

```
                         ┌─────────────────────────┐
                         │      CloudFront CDN     │
                         └───────────┬─────────────┘
                                     │
                         ┌───────────▼─────────────┐
                         │        AWS WAF          │ ◄── SQL injection, XSS, rate limiting
                         └───────────┬─────────────┘
                                     │
┌──────────────┐         ┌───────────▼─────────────┐         ┌──────────────────────┐
│  Mobile App  │ ──────► │     API Gateway         │ ──────► │   Lambda (NestJS)    │
└──────────────┘         └─────────────────────────┘         └──────────┬───────────┘
                                                                        │
                                                                   RDS Proxy
                                                                        │
                              ┌─────────────────────────────────────────┼─────────────────┐
                              │                     │                   │                 │
                   ┌──────────▼──────────┐ ┌───────▼───────┐ ┌─────────▼─────────┐ ┌─────▼─────┐
                   │  ElastiCache Redis  │ │    Aurora     │ │        S3         │ │  Azure AD │
                   │  - Hot lot data     │ │  PostgreSQL   │ │  - ML artifacts   │ │  (Auth)   │
                   │  - Predictions cache│ │  + PITR       │ │  - Data archive   │ └───────────┘
                   │  - Sub-ms reads     │ │  + Replicas   │ └───────────────────┘
                   └─────────────────────┘ └───────────────┘
```

### Added in Tier 3

| Service | Purpose | Monthly Cost |
|---------|---------|--------------|
| **ElastiCache Redis** | Sub-ms caching for lot status + predictions | ~$15 (t4g.micro) |
| **AWS WAF** | Advanced security | ~$5-10 |
| **Aurora PITR** | Point-in-time recovery (continuous backups) | ~$2-5 |
| **X-Ray** | Distributed tracing | ~$5 |
| **Secrets Manager** | Secure DB credentials rotation | ~$1 |

**Estimated cost: $100-200/month**

### When to Upgrade to Tier 3
- 10,000+ daily active users across multiple schools
- Need sub-10ms response times
- Security compliance requirements
- Debugging complex performance issues

---

## Cost Comparison

| Users | Tier 1 | Tier 2 | Tier 3 |
|-------|--------|--------|--------|
| 0 | $15 | $30 | $80 |
| 100 | $16 | $32 | $85 |
| 1,000 | $20 | $40 | $100 |
| 5,000 | $25 | $55 | $120 |
| 10,000 | $35 | $75 | $160 |
| 50,000 (multi-school) | $60 | $120 | $220 |

**Recommendation**: Start Tier 1, upgrade when you hit limits.

---

## Essential Services (All Tiers)

### Lambda + API Gateway
Your NestJS backend runs here. Zero cost when idle.

```typescript
// Deployed as a single Lambda function
// NestJS handles all routing internally
export const handler = serverlessExpress({ app });
```

### Aurora PostgreSQL (Serverless v2)
Auto-scaling relational database. Handles ML queries natively.

```
Min ACU: 0.5 (idle / low traffic)
Max ACU: 8   (burst / ML training)
```

**Why Aurora Serverless v2 over standard RDS:**
- Scales down to 0.5 ACU when idle (saves cost)
- Scales up automatically during ML training queries
- No instance selection or capacity planning
- Same PostgreSQL engine — zero vendor lock-in

### RDS Proxy (Connection Pooling)
Lambda functions are stateless — each invocation opens a new DB connection.
RDS Proxy pools and reuses connections, preventing exhaustion.

```
Lambda (100 concurrent) → RDS Proxy (connection pool) → Aurora (max_connections=100)
```

### Azure AD (Authentication)
Keep using Azure AD — it's free through CSULB and already works.

```
Mobile App → Azure AD (CSULB SSO) → JWT Token → API Gateway → Lambda
```

---

## PostgreSQL Schema

### Core Tables

```sql
-- Schools (multi-tenant support)
CREATE TABLE schools (
  school_id     TEXT PRIMARY KEY,          -- 'csulb', 'csuf', etc.
  name          TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Parking lots
CREATE TABLE lots (
  lot_id        TEXT NOT NULL,             -- 'G1', 'G2', etc.
  school_id     TEXT NOT NULL REFERENCES schools(school_id),
  lot_name      TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  lot_number    TEXT NOT NULL,
  lot_type      TEXT NOT NULL CHECK (lot_type IN ('STUDENT', 'EMPLOYEE')),
  capacity      INTEGER NOT NULL,
  current_occupancy INTEGER NOT NULL DEFAULT 0,
  location_desc TEXT,
  building_proximity TEXT[],
  center_lat    DOUBLE PRECISION NOT NULL,
  center_lng    DOUBLE PRECISION NOT NULL,
  geofence      JSONB NOT NULL,            -- polygon coordinates
  geofence_radius DOUBLE PRECISION,
  permit_types  TEXT[],
  daily_permit_allowed BOOLEAN DEFAULT FALSE,
  daily_rate    NUMERIC(5,2),
  hours_weekday JSONB,
  hours_saturday JSONB,
  hours_sunday  JSONB,
  ev_charging   INTEGER DEFAULT 0,
  motorcycle    INTEGER DEFAULT 0,
  accessible    INTEGER DEFAULT 0,
  has_lighting  BOOLEAN DEFAULT TRUE,
  has_cameras   BOOLEAN DEFAULT TRUE,
  has_emergency_phone BOOLEAN DEFAULT FALSE,
  is_covered    BOOLEAN DEFAULT FALSE,
  is_paved      BOOLEAN DEFAULT TRUE,
  levels        INTEGER,
  penetration_rate DOUBLE PRECISION DEFAULT 0,
  avg_turnover_minutes INTEGER DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (school_id, lot_id)
);

-- Users
CREATE TABLE users (
  email         TEXT PRIMARY KEY,
  school_id     TEXT NOT NULL REFERENCES schools(school_id),
  display_name  TEXT NOT NULL,
  preferences   JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

-- User favorites (many-to-many)
CREATE TABLE user_favorites (
  email         TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  school_id     TEXT NOT NULL,
  lot_id        TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (email, school_id, lot_id),
  FOREIGN KEY (school_id, lot_id) REFERENCES lots(school_id, lot_id)
);

-- Occupancy events (ENTER/EXIT from geofencing)
CREATE TABLE occupancy_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  school_id     TEXT NOT NULL,
  lot_id        TEXT NOT NULL,
  event_type    TEXT NOT NULL CHECK (event_type IN ('ENTER', 'EXIT')),
  device_hash   TEXT NOT NULL,             -- SHA-256 hash, no PII
  timestamp     TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id),
  FOREIGN KEY (school_id, lot_id) REFERENCES lots(school_id, lot_id)
);

-- Occupancy snapshots (every 15 min, for ML training)
CREATE TABLE occupancy_snapshots (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  school_id     TEXT NOT NULL,
  lot_id        TEXT NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  occupancy     INTEGER NOT NULL,
  available     INTEGER NOT NULL,
  occupancy_rate DOUBLE PRECISION NOT NULL, -- 0.0 to 1.0
  confidence    TEXT NOT NULL CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  reliability_score DOUBLE PRECISION,      -- 0-100
  is_cold_start BOOLEAN DEFAULT FALSE,

  -- Penetration rate estimation columns
  estimated_occupancy    INTEGER,          -- Scaled-up occupancy estimate
  penetration_rate_used  DOUBLE PRECISION, -- Effective penetration rate at snapshot time

  -- ML feature columns (populated at write time by academic-calendar.ts)
  semester        TEXT,                    -- fall | spring | summer | session | break
  academic_period TEXT,                    -- early | regular | midterms | late | dead_week | finals | break
  week_of_semester INTEGER,               -- 0-16
  is_campus_open BOOLEAN NOT NULL DEFAULT TRUE,

  PRIMARY KEY (id),
  FOREIGN KEY (school_id, lot_id) REFERENCES lots(school_id, lot_id)
);

-- Campus events (for event-aware predictions)
CREATE TABLE campus_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY,
  school_id     TEXT NOT NULL REFERENCES schools(school_id),
  event_name    TEXT NOT NULL,
  event_type    TEXT CHECK (event_type IN ('sports', 'graduation', 'concert', 'academic', 'other')),
  venue         TEXT,
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ,
  expected_attendance INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id)
);

-- Short-term predictions (overwritten every 15 min)
CREATE TABLE predictions_short_term (
  school_id     TEXT NOT NULL,
  lot_id        TEXT NOT NULL,
  prediction_hour INTEGER NOT NULL CHECK (prediction_hour BETWEEN 7 AND 21),
  predicted_occ DOUBLE PRECISION NOT NULL,
  ci_low        DOUBLE PRECISION NOT NULL,
  ci_high       DOUBLE PRECISION NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, lot_id, prediction_hour),
  FOREIGN KEY (school_id, lot_id) REFERENCES lots(school_id, lot_id)
);

-- Long-term predictions (overwritten daily)
CREATE TABLE predictions_long_term (
  school_id     TEXT NOT NULL,
  lot_id        TEXT NOT NULL,
  prediction_date DATE NOT NULL,
  prediction_hour INTEGER NOT NULL CHECK (prediction_hour BETWEEN 7 AND 21),
  predicted_occ DOUBLE PRECISION NOT NULL,
  historical_baseline DOUBLE PRECISION,
  adjustment    DOUBLE PRECISION,
  confidence    TEXT CHECK (confidence IN ('HIGH', 'MED', 'LOW')),
  days_ahead    INTEGER CHECK (days_ahead BETWEEN 1 AND 7),
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, lot_id, prediction_date, prediction_hour),
  FOREIGN KEY (school_id, lot_id) REFERENCES lots(school_id, lot_id)
);
```

### Indexes

```sql
-- Fast lot lookup
CREATE INDEX idx_lots_type ON lots(school_id, lot_type);

-- Occupancy events by lot + time (for snapshot aggregation)
CREATE INDEX idx_events_lot_time ON occupancy_events(school_id, lot_id, timestamp DESC);

-- Deduplication check
CREATE INDEX idx_events_device ON occupancy_events(device_hash, lot_id, timestamp DESC);

-- Snapshots for ML training queries
CREATE INDEX idx_snapshots_lot_time ON occupancy_snapshots(school_id, lot_id, timestamp DESC);
CREATE INDEX idx_snapshots_training ON occupancy_snapshots(school_id, lot_id, semester, academic_period, timestamp);

-- Predictions lookup (primary read path)
CREATE INDEX idx_pred_short ON predictions_short_term(school_id, lot_id);
CREATE INDEX idx_pred_long ON predictions_long_term(school_id, lot_id, prediction_date);
```

### Key ML Queries (Now Native SQL)

```sql
-- 4-week rolling average by day/hour (Stage 1: Historical Baseline)
SELECT
  lot_id,
  EXTRACT(dow FROM timestamp) AS day_of_week,
  EXTRACT(hour FROM timestamp) AS hour,
  AVG(occupancy_rate) AS avg_occupancy,
  STDDEV(occupancy_rate) AS std_occupancy,
  COUNT(*) AS sample_count
FROM occupancy_snapshots
WHERE school_id = 'csulb'
  AND academic_period = 'regular'
  AND timestamp > NOW() - INTERVAL '4 weeks'
GROUP BY lot_id, day_of_week, hour
ORDER BY lot_id, day_of_week, hour;

-- Training data export for XGBoost
SELECT
  s.lot_id,
  s.timestamp,
  s.occupancy,
  s.occupancy_rate,
  s.confidence,
  s.semester,
  s.academic_period,
  s.is_campus_open,
  s.week_of_semester,
  s.estimated_occupancy,
  s.penetration_rate_used,
  EXTRACT(dow FROM s.timestamp) AS day_of_week,
  EXTRACT(hour FROM s.timestamp) AS hour,
  l.lot_type,
  l.capacity
FROM occupancy_snapshots s
JOIN lots l ON s.school_id = l.school_id AND s.lot_id = l.lot_id
WHERE s.school_id = 'csulb'
  AND s.timestamp > NOW() - INTERVAL '12 weeks'
ORDER BY s.lot_id, s.timestamp;

-- Get all lots with current predictions (single query)
SELECT
  l.*,
  l.capacity - l.current_occupancy AS available,
  ROUND(l.current_occupancy::numeric / NULLIF(l.capacity, 0), 3) AS occupancy_rate,
  p.predicted_occ,
  p.ci_low,
  p.ci_high
FROM lots l
LEFT JOIN predictions_short_term p
  ON l.school_id = p.school_id
  AND l.lot_id = p.lot_id
  AND p.prediction_hour = EXTRACT(hour FROM NOW())
WHERE l.school_id = 'csulb';
```

### Data Retention

| Table | Retention | Strategy |
|-------|-----------|----------|
| `lots`, `users`, `schools` | Permanent | Core data |
| `occupancy_events` | 30 days | Daily cron `DELETE WHERE timestamp < NOW() - INTERVAL '30 days'` (`apps/backend/src/scripts/prune-old-data.ts`, override with `RETENTION_DAYS` env). Honors README privacy promise; snapshots already carry the aggregated history needed for ML. |
| `occupancy_snapshots` | Permanent | Primary ML training source (archival to S3 optional at Tier 2) |
| `weather` | 30 days | Same `prune-old-data` cron. ML reads only the latest row (LIMIT 1) and trains on snapshots, so historical observations are unused after the 3 h staleness gate. |
| `weather_forecasts` | Self-pruning | `fetch-weather-forecast` cron deletes rows where `target_time < now()` before each upsert pass. |
| `predictions_short_term` | Overwritten each cycle | UPSERT every 15 min |
| `predictions_long_term` | Overwritten daily | UPSERT daily |
| `campus_events` | Permanent | Powers the mobile nearby-events display + notification surface (not a forecasting input as of 2026-04-30) |

---

## Security (All Tiers)

### Tier 1 Security (Included)
- ✅ HTTPS/TLS (API Gateway default)
- ✅ Azure AD JWT validation
- ✅ IAM least-privilege roles
- ✅ RDS encryption at rest (AES-256)
- ✅ RDS encryption in transit (SSL)
- ✅ Basic rate limiting (10k req/sec)

### Tier 3 Security (Optional)
- ☐ AWS WAF (XSS, rate limiting)
- ☐ Secrets Manager (DB credential rotation)
- ☐ CloudFront geo-blocking
- ☐ VPC + Security Groups for DB isolation

### Authentication Flow
```
Mobile App → Azure AD (CSULB SSO) → Access Token
     │
     └──► API Gateway → Lambda validates JWT → Aurora PostgreSQL
```

- Access token expiry: 1 hour
- Refresh token rotation enabled
- Secure storage: iOS Keychain / Android Keystore

---

## Environments

| Environment | Database | Tier |
|-------------|----------|------|
| `dev` | PostgreSQL (Docker) | Local |
| `staging` | Aurora Serverless v2 | Tier 1 |
| `prod` | Aurora Serverless v2 | Tier 1-3 |

---

## Deployment (CDK)

Infrastructure as Code using **AWS CDK** (TypeScript):

```bash
# Install CDK
npm install -g aws-cdk

# Bootstrap (first time only)
cdk bootstrap

# Deploy
cdk deploy SharkparkStack --context tier=1
```

### CDK Project Structure (To Create)
```
infrastructure/
├── bin/
│   └── app.ts              # Entry point
├── lib/
│   ├── tier1-stack.ts      # Lambda + API Gateway + Aurora + RDS Proxy
│   ├── tier2-stack.ts      # + CloudFront + S3 + Read Replica
│   └── tier3-stack.ts      # + ElastiCache + WAF
├── cdk.json
├── package.json
└── tsconfig.json
```

---

## CI/CD Pipeline

```
GitHub Push → GitHub Actions → Build & Test → CDK Deploy
                    │
                    ├── pnpm test (backend)
                    ├── pnpm test (mobile)
                    ├── pnpm lint
                    ├── prisma migrate deploy (DB migrations)
                    └── cdk deploy (on main branch)
```

---

## Local Development

```bash
# Start local PostgreSQL 17 + MinIO (S3-compatible, mirrors prod Neon + R2)
docker-compose -f docker/docker-compose.yml up -d

# Run database migrations
pnpm prisma migrate dev

# Seed database (lots, users, events, weather, historical snapshots)
pnpm db:seed

# Start backend (NestJS on port 3000)
cd apps/backend && pnpm dev

# Start mobile (Metro bundler on port 8081)
cd apps/mobile && pnpm start
```

### Local Architecture
```
Mobile App (iOS Simulator)
    │
    ▼
NestJS Backend (localhost:3000)
    │
    ▼
PostgreSQL 17 (localhost:5433)  ←── docker-compose (mirrors Neon prod)
MinIO S3 (localhost:9000)        ←── ML artifacts + DB backups (mirrors R2)
```

---

## ML Pipeline

ML predictions query the database directly — no export pipeline required.

### Short-Term Inference (Every 15 min)
```
EventBridge (cron) → Lambda (ML inference)
                        │
                        ├── 1. Query occupancy_snapshots (training data)
                        ├── 2. Run XGBoost model
                        └── 3. UPSERT predictions_short_term
```

### Long-Term Inference (Daily)
```
EventBridge (cron) → Lambda (ML inference)
                        │
                        ├── 1. Query occupancy_snapshots
                        ├── 2. Compute historical baselines (SQL window functions)
                        ├── 3. Run XGBoost adjustment model
                        └── 4. UPSERT predictions_long_term
```

### Weekly Retraining
```
EventBridge (weekly) → Lambda or SageMaker
                          │
                          ├── 1. Query training data (SQL JOIN with lots, calendar)
                          ├── 2. Train candidate model
                          ├── 3. Evaluate vs production model
                          ├── 4. Register in MLflow
                          └── 5. If better → deploy to S3 → Lambda pulls new model
```

### Model & Artifact Storage
| Concern | Storage |
|---------|---------|
| Training data | Aurora PostgreSQL (permanent, queryable) |
| Model artifacts (.pkl, .xgb) | S3 (Tier 2+) or local MLflow (dev) |
| Experiment tracking | MLflow (local) |
| Predictions | Aurora PostgreSQL (`predictions_*` tables) |

---

## Multi-School Architecture

PostgreSQL supports multi-school out of the box via `school_id` foreign keys.

```sql
-- Adding a new school is one INSERT
INSERT INTO schools (school_id, name) VALUES ('csuf', 'Cal State Fullerton');

-- All queries are scoped by school_id
SELECT * FROM lots WHERE school_id = 'csuf';
```

### Scaling Strategy
| Scale | Strategy |
|-------|----------|
| 1-3 schools | Single Aurora instance, `school_id` column |
| 3-10 schools | Aurora + read replicas (ML queries on replica) |
| 10+ schools | Consider schema-per-school or separate clusters |

---

## Migration Plan (DynamoDB → PostgreSQL)

### Phase 1: Database Setup ✅
- [x] Add PostgreSQL to `docker-compose.yml` for local dev
- [x] Set up Prisma ORM with schema
- [x] Run initial migrations
- [x] Write seed script for PostgreSQL

### Phase 2: Backend Refactor ✅
- [x] Replace `DatabaseModule` (DynamoDB client → Prisma client)
- [x] Rewrite `LotsService` — remove app-side joins, use SQL JOINs
- [x] Rewrite `UsersService` — standard CRUD with relations
- [x] Rewrite `OccupancyEventsService` — INSERT + aggregate queries
- [x] Rewrite `ReliabilityComputationService` — SQL aggregations

### Phase 3: ML Integration (Week 5-6)
- [x] Add `occupancy_snapshots` with ML features (`semester`, `academic_period`, `week_of_semester`, `is_campus_open`)
- [x] Add `predictions_short_term` and `predictions_long_term` tables
- [ ] Build ML training data queries (direct SQL)

### Phase 4: Testing & Cleanup ✅
- [x] Update all backend tests for PostgreSQL (17 suites, 142 tests passing)
- [ ] Update e2e tests
- [x] Remove DynamoDB dependencies (`@aws-sdk/client-dynamodb`, `setup-dynamodb-schema.ts`)
- [ ] Update mobile API types if prediction format changed
- [ ] Performance benchmarking

---

## Quick Reference

### Tier 1 Checklist (Launch)
- [ ] Create AWS account
- [ ] Set up CDK project
- [ ] Deploy Aurora Serverless v2 + RDS Proxy
- [ ] Deploy Lambda + API Gateway
- [ ] Run Prisma migrations on Aurora
- [ ] Configure Azure AD app registration
- [ ] Seed initial lot data
- [ ] Test mobile app against staging

### Upgrade Triggers

| Symptom | Solution |
|---------|----------|
| Response times > 200ms | Add CloudFront (Tier 2) |
| ML training slowing reads | Add Read Replica (Tier 2) |
| Need model artifact storage | Add S3 (Tier 2) |
| 10,000+ DAU | Add ElastiCache (Tier 3) |
| Security audit required | Add WAF (Tier 3) |
| Debugging performance | Add X-Ray (Tier 3) |
