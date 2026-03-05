# Model Design

Technical decisions and rationale for SharkPark's prediction models.

## Table of Contents

- [Prediction Types](#prediction-types)
  - [Short-term](#short-term-what-will-this-lot-look-like-at-2pm)
  - [Long-term](#week-ahead-what-will-lot-g2-look-like-next-thursday-at-10am)
- [PostgreSQL Schemas](#postgresql-schemas)
- [Model Rationale](#model-rationale)
  - [XGBoost Regression](#short-term-predictions-xgboost-regression)
  - [Aggregation-Based Classification](#long-term-predictions-aggregation)
- [Synthetic Data](#synthetic-data)
  - [Cold-Start Strategy](#cold-start-strategy)
- [Feature Engineering](#feature-engineering)
  - [Event Features](#event-features-future)
  - [Weather Features](#weather-features-future)
  - [Confidence Intervals](#confidence-intervals)
- [Reliability Scoring](#reliability-scoring)
- [Model Evaluation](#model-evaluation)
  - [Database Architecture](#database-architecture)
  - [Training Data Archive (S3)](#training-data-archive-s3)
  - [Metrics](#metrics)
  - [Baseline Comparisons](#baseline-comparisons)
- [Deployment Architecture](#deployment-architecture)
  - [Retraining Triggers](#retraining-triggers)
  - [Model Promotion](#model-promotion)
  - [Requirements](#requirements)
  - [Current vs Future](#current-vs-future)

## Prediction Types

### Short-term: "What will this lot look like at 2pm?"

- **Model:** XGBoost regression
- **Runs:** Every 15 minutes
- **Horizon:** Hours 7:00–21:00 (15 prediction points per lot)
- **Predicts:** Occupancy for each hour (7-21) per lot
- **Purpose:** Immediate parking decisions

**Key insight:** This is a state-transition problem, not a time series forecasting problem. Current occupancy and momentum matter more than seasonal patterns for short horizons.

### Long-term: "What will Lot G2 look like next Thursday at 10am?"

- **Model:** Two-stage hybrid (Historical Baseline + XGBoost Adjustment)
- **Runs:** Daily (rolling 7-day window)
- **Horizon:** 1-7 days ahead, hourly predictions (7:00-21:00)
- **Predicts:** Per-lot occupancy for each hour, each day for next week
- **Purpose:** Help students plan their week - which days to drive, when to arrive early, which lots to target

**Key insight:** Long-term forecasting requires different features than short-term. Historical patterns and calendar effects matter more than current state. Accuracy degrades with distance (day 1 more accurate than day 7).


## PostgreSQL Schemas

All data lives in a single PostgreSQL database (Aurora PostgreSQL Serverless v2 in production, Docker PostgreSQL 16 locally), managed by Prisma ORM v7. The schemas below match the Prisma models in `apps/backend/prisma/schema.prisma`.

### Input: OccupancySnapshot

Generated every 15 minutes by the backend scheduler. Each snapshot captures lot state at a point in time, with ML feature columns baked in at write time.

```sql
CREATE TABLE occupancy_snapshots (
  id                TEXT PRIMARY KEY,     -- CUID
  lot_id            TEXT NOT NULL,         -- FK → lots.id
  timestamp         TIMESTAMP NOT NULL,
  occupancy         INT NOT NULL,
  available         INT NOT NULL,
  occupancy_rate    FLOAT NOT NULL,
  confidence        confidence_level NOT NULL,  -- LOW | MEDIUM | HIGH
  reliability_score FLOAT,
  is_cold_start     BOOLEAN,

  -- ML feature columns (populated at write time)
  academic_period   TEXT,                  -- "FALL", "SPRING", "SUMMER", "BREAK"
  week_of_semester  INT,
  is_campus_open    BOOLEAN DEFAULT TRUE
);
-- Indexes: (lot_id, timestamp), (lot_id, timestamp, academic_period)
```

### Output: Short-Term Predictions

```sql
CREATE TABLE predictions_short_term (
  id                  TEXT PRIMARY KEY,     -- CUID
  lot_id              TEXT NOT NULL,         -- FK → lots.id
  predicted_at        TIMESTAMP NOT NULL,    -- when the model ran
  target_time         TIMESTAMP NOT NULL,    -- the future time being predicted
  predicted_occupancy INT NOT NULL,
  confidence_lower    INT NOT NULL,          -- 10th percentile bound
  confidence_upper    INT NOT NULL,          -- 90th percentile bound
  model_version       TEXT NOT NULL
);
-- Index: (lot_id, target_time)
```

### Output: Long-Term Predictions

```sql
CREATE TABLE predictions_long_term (
  id                  TEXT PRIMARY KEY,     -- CUID
  lot_id              TEXT NOT NULL,         -- FK → lots.id
  predicted_at        TIMESTAMP NOT NULL,    -- when the model ran
  target_date         TIMESTAMP NOT NULL,    -- the future date being predicted
  target_hour         INT NOT NULL,          -- 0-23
  predicted_occupancy INT NOT NULL,
  confidence_lower    INT NOT NULL,
  confidence_upper    INT NOT NULL,
  model_version       TEXT NOT NULL
);
-- Index: (lot_id, target_date, target_hour)
```

### Supporting Tables

The ML pipeline also reads from these operational tables:

| Table | ML Role | Key Columns |
|-------|---------|-------------|
| `lots` | Lot metadata & capacity | `lot_id`, `capacity`, `current_occupancy`, `lot_type`, `penetration_rate`, `confidence` |
| `campus_events` + `event_impacts` | Event-aware features | `event_type` (ATHLETIC \| ACADEMIC \| PERFORMANCE \| OTHER), `expected_attendance`, `impact_level`, `expected_increase_percent` |
| `weather` | Weather features | `temperature_f`, `humidity_percent`, `wind_speed_mph`, `precipitation_probability`, `is_raining` |
| `academic_calendar` | Period classification | `period_type` (FALL \| SPRING \| SUMMER \| BREAK), `start_date`, `end_date` |
| `campus_closures` | `is_campus_open` flag | `date`, `reason` |

## Model Rationale

### Short-Term Predictions; XGBoost Regression

Ideally, separate models per lot (or lot type) would capture unique patterns (lot type, relative location, etc.) However, this requires substantial data per lot to train reliably.
For now, we use one global model with lot as a categorical feature:

- Works with limited data (lots share learned patterns)
- New lots get reasonable predictions immediately
- Simpler to maintain
- Can revisit per-lot models once enough real data accumulates

**Why XGBoost over alternatives:**

| Model | Pros | Cons | Verdict |
|-------|------|------|---------|
| XGBoost/LightGBM | Fast, handles tabular data well, interpretable feature importance | Requires manual lag features | ✅ Best fit for MVP |
| LSTM | Captures temporal dependencies automatically | Needs more data, harder to debug, overkill for state-transition problems | Revisit with 6+ months data |
| Random Forest | Simple, no hyperparameter tuning | Slower, typically lower accuracy than boosting | Use as baseline |

Tree-based boosting handles limited/noisy data well and captures non-linear relationships (e.g., lots filling differently at different times) without extensive feature engineering.

### Long-Term Predictions: Two-Stage Hybrid

Week-ahead predictions answer "what will parking look like next Thursday at 10am?" - per-lot hourly forecasts for planning the entire week.

**Architecture:**

#### Stage 1: Historical Baseline
- Compute 4-week rolling average for each `(lot_id, day_of_week, hour)` combination
- Rolling average only uses data from the same `academic_period` — break data is not mixed with regular semester data
- During breaks/summer with no prior break data, baseline falls back to near-zero (campus is largely empty)
- Adjust for week-of-semester effects (e.g., week 1 lighter, finals week heavier)
- **Output:** "Lot G2 on Tuesday at 10am typically has 75% occupancy in week 8"

#### Stage 2: XGBoost Adjustment
- Train single XGBoost model to predict **deviations** from baseline
- **Target:** `actual_occupancy - historical_baseline`
- **Final prediction:** `predicted_occupancy = historical_baseline + xgboost_adjustment`

**Why two-stage over alternatives:**

| Model | Pros | Cons | Verdict |
|-------|------|------|---------|
| Two-Stage Hybrid | Interpretable, works with 4 weeks data, fast inference | Two components to maintain | ✅ Best for MVP (weeks 0-12) |
| Single XGBoost | Cleaner code | Needs more data to learn cycles; less interpretable | Two-stage splits problem better |
| LSTM/GRU | Learns temporal dependencies automatically | Needs 6+ months data, harder to debug | Revisit at month 6+ |
| Prophet | Good for seasonality | Needs 1+ year; can't leverage lot features | Not suitable for cold-start |
| Transformer/TFT | State-of-art multi-horizon | Needs massive data, computationally expensive | Overkill for 7-day horizon with limited data |

---



## Synthetic Data

- Used to validate the pipeline before real data is available.
- **Rationale:** With 28 lots × 14 hours × 7 days = 2,744 unique combinations, we need sufficient samples per combination for XGBoost to learn patterns.

### Volume Guidelines

| Model      | Initial     | Growing       | Notes                                                                            |
|------------|-------------|---------------|----------------------------------------------------------------------------------|
| Short-term | 5,000-7,000 | 10,000-20,000 | XGBoost is sample-efficient, but needs ~2-3 samples per lot/hour/day combination |
| Long-term | 10,000-15,000 | 20,000-30,000 | Need coverage across 16 weeks × 28 lots × 7 days × 14 hours to capture semester cycles |


### What it simulates

- Time-of-day curves (peaks at 10am, 1pm)
- Day-of-week variation (lighter weekends)
- Semester patterns (dead during breaks)
- Non-semester periods (campus closures, breaks, summer) with near-zero occupancy
- Event impacts (spikes near campus events)
- Noise and random fluctuations

### Transition to Real Data

| Phase       | Source     | Notes                                              |
|-------------|------------|----------------------------------------------------|
| Now         | Seed data  | Prisma seed script generates 7 days of snapshots   |
| Post-launch | PostgreSQL | Real snapshots collected every 15min by scheduler   |
| Mature      | PostgreSQL | 60+ days of real data, synthetic for tests only     |




### Cold-Start Strategy

At launch, we'll have zero historical data. Here's how we bootstrap predictions:

| Model      | Cold-Start Approach                                                            |
|------------|--------------------------------------------------------------------------------|
| Short-term | Use synthetic-trained model; predictions improve as real data accumulates      |
| Long-term  | Use synthetic-trained two-stage model; baseline strengthens with each week of real data |



**Long-term bootstrapping:**

1. **Week 1-2:** Baseline uses synthetic patterns + early real data; confidence = "LOW"
2. **Week 3-4:** Baseline uses 4 weeks real data; XGBoost learns real deviations; confidence = "MED"
3. **Week 5+:** Full reliance on accumulated real data; confidence = "HIGH" (if MAE meets targets)

**Academic calendar integration:**

The `academic_period` feature (`regular`, `finals`, `break`, `summer`) is derived from CSULB's academic calendar and is a core feature for both models — not a future addition. Campus closures (holidays, breaks) are also tracked via `is_campus_open`.

**Additional external signals (future):**

- Class schedule density by day
- Known campus events




## Feature Engineering

### Short-term Features

- Current occupancy (most important)
- Lag features: occupancy at t-15min, t-30min, t-45min, t-60min
- Momentum: rate of change (e.g., `current - occupancy_15min_ago`)
- Time context: hour of day, day of week
- Lot ID (categorical)
- `academic_period`: categorical (`regular`, `finals`, `break`, `summer`) — derived from CSULB academic calendar. During breaks/summer, the model learns that low occupancy is expected rather than treating it as anomalous.

### Long-term Features

**Stage 1 (Historical Baseline):**
- 4-week rolling average for `(lot_id, day_of_week, hour)` combination
- Week-of-semester adjustment factor
- Historical variance (for confidence estimation)

**Stage 2 (XGBoost Adjustment):**
- `historical_baseline` (from Stage 1)
- `days_ahead` (1-7, critical for horizon-specific learning)
- `day_of_week`, `hour`
- `week_of_semester` (1-16 during active semester, 0 outside semester)
- `academic_period`: categorical (`regular`, `finals`, `break`, `summer`) — primary indicator for whether normal occupancy patterns apply
- `is_campus_open`: boolean — false on holidays/closures (Labor Day, Thanksgiving, etc.)
- `lot_id` (categorical)
- Weather forecasts (future, days 1-5): `temperature_forecast`, `precipitation_prob`

**Key difference from short-term:** No lag features or current state. Week-ahead relies on patterns and calendar, not real-time conditions.

### Event Features (Future)

Event-aware forecasting will incorporate campus events as features:

- `event_active`: boolean, is there an event within 2 hours?
- `event_type`: categorical (ATHLETIC, ACADEMIC, PERFORMANCE, OTHER) — matches `CampusEventType` enum
- `event_magnitude`: expected attendance bucket (SMALL < 500, MEDIUM < 2000, LARGE 2000+) — derived from `expected_attendance`
- `event_proximity`: distance from lot to event venue (closer lots affected more) — via `event_impacts` join table with `impact_level` and `expected_increase_percent`
- `time_to_event`: minutes until event start (captures pre-event arrival patterns)

**Data source:** `campus_events` and `event_impacts` tables in PostgreSQL, synced from university calendar API.

### Weather Features (Future)

Weather-aware forecasting will incorporate conditions that affect parking demand:

- `temperature`: current temperature (°F)
- `precipitation_probability`: 0-100%
- `precipitation_type`: none, rain, snow
- `weather_severity`: NORMAL, ADVISORY, WARNING

**Data source:** Weather API (OpenWeatherMap or similar), cached in `weather` table in PostgreSQL.

**Expected impact:**

- Rain/snow → increased driving, higher lot occupancy
- Extreme heat → preference for covered/shaded lots
- Severe weather → reduced campus activity overall

### Confidence Intervals

Short-term predictions include `ci_low` and `ci_high` bounds to communicate uncertainty.

**Method: Quantile Regression**

Train three XGBoost models with different loss functions:

- **Median model:** Standard regression for `predicted_occupancy`
- **Lower bound model:** Quantile loss at 10th percentile for `confidence_lower`
- **Upper bound model:** Quantile loss at 90th percentile for `confidence_upper`

**Why quantile regression over alternatives:**

| Method             | Pros                          | Cons                                      |
|--------------------|-------------------------------|-------------------------------------------|
| Quantile Regression| Direct, interpretable bounds  | Requires 3 models                         |
| Bootstrap          | Single model                  | Slow inference, less stable               |
| Ensemble Variance  | Free with tree models         | Underestimates uncertainty on sparse data |

**Interpretation:**

- `confidence_lower`: "We're 90% confident occupancy will be at least this"
- `confidence_upper`: "We're 90% confident occupancy will be at most this"
- Wide interval = low confidence, narrow = high confidence

## Reliability Scoring

The backend includes a multi-factor reliability scoring system that feeds into snapshot `confidence` and `reliability_score` fields. This data is exposed via the `/api/v1/reliability` endpoints and informs model confidence.

**Weighted factors:**

| Factor | Weight | Description |
|--------|--------|-------------|
| Penetration rate | 35% | `lot.penetration_rate` vs target (e.g., 0.5 = 50% of devices detected) |
| Data freshness | 25% | Time since last occupancy event |
| Event frequency | 20% | ENTER/EXIT events per hour |
| Sample size | 15% | Unique devices observed |
| Historical accuracy | 5% | Past prediction accuracy (future) |

**Confidence thresholds:** HIGH ≥ 70, MEDIUM ≥ 40, LOW < 40

**Cold-start detection:** A lot is flagged as cold-start if any of:
- Penetration rate < 5% of target
- Fewer than 2 events/hour
- Fewer than 3 unique devices
- Data staleness > 2× freshness window

Cold-start lots get `confidence: LOW` and `is_cold_start: true` on their snapshots, signaling the ML pipeline to widen confidence intervals.

## Model Evaluation

### Database Architecture

All data lives in a single PostgreSQL database (Aurora PostgreSQL Serverless v2 in production).

| Table | Purpose | Retention |
|-------|---------|----------|
| `lots`, `users`, `campus_events`, etc. | Operational data | Permanent |
| `occupancy_snapshots` | 15-min snapshots with ML feature columns | Permanent (archive older data to S3) |
| `occupancy_events` | Raw ENTER/EXIT events | Permanent (archive older data to S3) |
| `predictions_short_term` | Short-term predictions (hourly by lot) | Overwritten each cycle |
| `predictions_long_term` | Week-ahead predictions (7 days × hourly by lot) | Overwritten daily |

> **Note:** Unlike DynamoDB's TTL-based cleanup, PostgreSQL data is retained permanently. For cost management at scale, older `occupancy_snapshots` and `occupancy_events` rows should be archived to S3 and pruned periodically.

**Volume estimates:**

- Snapshots: ~2,688 records/day (28 lots × 96 snapshots/day)
- Short-term predictions: ~2,688 records/day (28 lots × 96 predictions/day)
- Long-term predictions: ~2,744 records/day (28 lots × 7 days × 14 hours)

### Training Data Archive (S3)
PostgreSQL retains data permanently, but archiving older data to S3 reduces database size and enables efficient batch queries for model training.

| S3 Path                          | Source Table              | Retention | Purpose                              |
|----------------------------------|---------------------------|-----------|--------------------------------------|
| `s3://sharkpark-ml/occupancy/`   | `occupancy_snapshots`     | Permanent | Historical occupancy for retraining  |
| `s3://sharkpark-ml/weather/`     | `weather`                 | Permanent | Weather correlation analysis         |
| `s3://sharkpark-ml/events/`      | `campus_events` + `event_impacts` | Permanent | Event impact modeling       |
| `s3://sharkpark-ml/raw-events/`  | `occupancy_events`        | Permanent | Raw ENTER/EXIT events for feature engineering |

**Archive schedule:** Daily export job writes new records to S3 in Parquet format, partitioned by date. This enables efficient queries for retraining (e.g., "all data from Fall 2025 semester").




### Metrics

| Model      | Primary Metric | Secondary Metrics | Target                    |
|------------|----------------|-------------------|---------------------------|
| Short-term | MAE            | RMSE, MAPE        | MAE < 10% of lot capacity |
| Long-term | MAE (horizon-stratified) | RMSE, day-ahead accuracy | Day 1-2: <10%, Day 3-5: <15%, Day 6-7: <25% |

**Long-term horizon-stratified evaluation:**

Accuracy degrades with forecast distance. We track MAE separately by horizon:

| Days Ahead | Target MAE | Rationale |
|------------|-----------|-----------|
| Day 1-2 | <10% capacity | Near-term predictions should be quite accurate |
| Day 3-5 | <15% capacity | Reasonable accuracy for mid-week planning |
| Day 6-7 | <25% capacity | Acceptable degradation for far-ahead forecasts |

**Metric definitions:**

- **MAE (Mean Absolute Error):** Average absolute difference between predicted and actual occupancy
- **RMSE (Root Mean Square Error):** Penalizes large errors more heavily
- **MAPE (Mean Absolute Percentage Error):** Error as percentage of actual value
- **Horizon-stratified MAE:** MAE calculated separately for each forecast distance (day 1, day 2, ..., day 7)
- **Day-ahead accuracy:** Percentage of day 1 predictions within ±10% of actual occupancy

### Baseline Comparisons

Models must beat these naive baselines to be considered useful:

| Baseline              | Description                                      | Use Case               |
|-----------------------|--------------------------------------------------|------------------------|
| Persistence           | Predict current occupancy stays the same         | Short-term             |
| Historical Average    | Same hour + day-of-week average from last 4 weeks| Short-term, Long-term |
| Same-Day-Last-Week    | Predict Thursday = last Thursday's actual        | Long-term             |
| Majority Class        | Always predict median occupancy                  | Long-term             |

**Minimum improvement threshold:** New model must reduce MAE by ≥5% vs current production model OR improve day-ahead accuracy by ≥3%.


## Deployment Architecture

**Scheduling:**
- AWS Lambda + EventBridge

**Model & artifact storage:**
- MLflow (model registry, experiment tracking, artifact management)
- S3 (MLflow artifact backend, training data archives)
---
### Retraining Triggers

**Scheduled:**
- Weekly retrain job (manual script for now, Lambda later)
- Always runs, compares candidate against current production model

**Drift-based (future):**
- Hourly health check Lambda computes MAE on last 24h of predictions vs actuals
- If MAE > 1.5× baseline for 3 consecutive checks → trigger retrain
---



### Model Promotion

**Criteria:**
A candidate model must meet at least one:
- Reduce MAE by ≥5%
- Improve directional accuracy by ≥3%
- Evaluated on held-out test set from most recent 2 weeks

**Workflow (local dev):**
1. Train candidate model
2. Evaluate candidate vs current production model
3. If candidate wins → register in MLflow

**Workflow (later):**
1. Same as above
2. Export to S3 → Lambda pulls new model on next invoke

**Rollback:** Revert to previous MLflow version (local) or re-export previous version to S3 (later).
-----

### Recommendation: Lambda + EventBridge

For MVP, Lambda + EventBridge is recommended because:

| Factor              | Lambda + EventBridge                    | ECS Scheduled Tasks        |
|---------------------|-----------------------------------------|----------------------------|
| Cost                | Pay per invocation (~$0.50/month)       | Minimum container costs    |
| Cold start          | 1-2s (acceptable for batch job)         | 30-60s task spin-up        |
| Model size limit    | 50MB uncompressed in /tmp               | No limit                   |
| Complexity          | Low (single function)                   | Medium (container + task)  |

**Constraints:**

- XGBoost model must be <50MB (typical for our use case: ~5-15MB)
- If model grows larger, switch to ECS Fargate Spot
- Use Lambda Provisioned Concurrency only if cold starts become problematic
### Requirements
| Job                   | Frequency      | Output                                         |
|-----------------------|----------------|------------------------------------------------|
| Short-term inference  | Every 15 min   | Predictions for hours 7–21 (per lot)           |
| Long-term inference   | Daily          | Predictions for next 7 days × hourly (per lot) |
| Retraining            | Weekly         | Updated models registered to MLflow            |
| S3 archive export     | Daily          | Training data backup to S3                     |

### Current vs Future
> **Note:** "Now" reflects local development before shared team infrastructure is set up.
**Development Phases:** MLflow runs locally during development, storing experiments and artifacts in `./mlruns`. Once shared infrastructure is set up, production models get exported to S3 for Lambda to pull — MLflow stays local for experiment tracking.

| Concern                 | Now                           | Later                         |
|-------------------------|-------------------------------|-------------------------------|
| Model storage           | MLflow (local artifacts)      | S3                            |
| Model tracking/registry | MLflow (local tracking)       | MLflow (local tracking)       |
| Training data archive   | Local files                   | S3                            |
| Inference trigger       | Manual script                 | EventBridge + Lambda          |
| Training trigger        | Manual script                 | Scheduled or manual           |