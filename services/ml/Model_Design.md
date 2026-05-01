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

  -- Penetration rate estimation columns
  estimated_occupancy    INT,              -- Scaled-up occupancy estimate
  penetration_rate_used  FLOAT,            -- Effective penetration rate at snapshot time

  -- ML feature columns (populated at write time by academic-calendar.ts)
  semester          TEXT,                  -- fall | spring | summer | session | break
  academic_period   TEXT,                  -- early | regular | midterms | late | dead_week | finals | break
  week_of_semester  INT,
  is_campus_open    BOOLEAN DEFAULT TRUE
);
-- Indexes: (lot_id, timestamp), (lot_id, timestamp, semester, academic_period)
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
| ~~`campus_events` + `event_impacts`~~ | ~~Event-aware features~~ | **Removed 2026-04-30:** events are surfaced as a display/notification context layer in mobile, not as a model feature. Too sparse/noisy to improve per-lot occupancy predictions. |
| `weather` | Weather features | `temperature_f`, `humidity_percent`, `wind_speed_mph`, `precipitation_probability`, `is_raining` |
| `academic_calendar` | Period classification | `semester`, `period_type`, `week_of_semester` — provided by `academic_calendar.py` |
| `campus_closures` | `is_campus_open` flag | `is_campus_open(date)` — provided by `academic_calendar.py` |

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

**Default Hyperparameters:**

Shared across all three XGBoost models (median, 10th percentile, 90th percentile):

| Parameter | Value | Notes |
|-----------|-------|-------|
| `n_estimators` | 200 | Number of boosting rounds |
| `max_depth` | 6 | Maximum tree depth |
| `learning_rate` | 0.1 | Step size shrinkage |
| `subsample` | 0.8 | Row sampling per tree |
| `colsample_bytree` | 0.8 | Feature sampling per tree |
| `random_state` | 42 | Reproducibility seed |

Currently hardcoded in `src/models/short_term.py`. These are reasonable defaults for tabular data of this size — tuning is deferred until real data is available to validate against.

### Long-Term Predictions: Two-Stage Hybrid

Week-ahead predictions answer "what will parking look like next Thursday at 10am?" - per-lot hourly forecasts for planning the entire week.

**Architecture:**

#### Stage 1: Historical Baseline
- Compute 4-week rolling average for each `(lot_id, academic_period, day_of_week, hour)` combination
- Rolling average only uses data from the same `academic_period` — break data is not mixed with regular semester data
- **Coverage fallback:** if a group has < 2 unique days of data, falls back to the global `(day_of_week, hour)` mean across all lots. The 4-week window caps coverage at 4 days per group, and short periods (dead_week, midterms) cap it further. The fallback is not scoped by academic_period — acceptable while the pool is small.
- During breaks/summer with no prior break data, baseline falls back to near-zero (campus is largely empty)
- Adjust for week-of-semester effects (e.g., week 1 lighter, finals week heavier)
- **Confidence filtering:** LOW-confidence rows are excluded from baseline computation by default. The baseline is a simple unweighted mean — it has no mechanism to downweight noisy rows, so including LOW-confidence readings directly skews the average. XGBoost training keeps all confidence levels and uses `cold_start_weight` instead (weighting, not filtering). **Future improvement:** replace binary include/exclude with a weighted mean (e.g. HIGH=1.0, MEDIUM=0.5, LOW=0.1) once real data reveals how noisy LOW-confidence readings actually are.
- **Output:** "Lot G2 on Tuesday at 10am typically has 75% occupancy in week 8"

#### Stage 2: XGBoost Adjustment
- Train single XGBoost model to predict **deviations** from baseline
- **Target:** `actual_occupancy - historical_baseline`
- **Final prediction:** `predicted_occupancy = historical_baseline + xgboost_adjustment`

> **Known gap — period boundaries and unseen periods:** Because the baseline is restricted to the last 4 weeks *and* filtered by `academic_period`, a given period's slice within the window is often only 1–2 weeks. At the first occurrence of a short period (e.g., `dead_week`, `finals`), or at period boundaries where only 1 week of the new period is in the window, the lot-specific baseline either has < 2 coverage days (triggering the global fallback) or does not exist at all (forcing every row to the global fallback). The global fallback itself is not scoped by period, so it returns a cross-period `(day_of_week, hour)` mean that may not reflect the target period's typical occupancy. Stage 2 XGBoost has `academic_period` as a categorical feature, so it can learn period-specific corrections to an inaccurate baseline — we rely on this to correct the gap for MVP. Once multi-semester real data is available, a cross-semester baseline lookup (pull same-period data from prior semesters) is the right fix.

> **Confidence filtering policy:** Training pipelines do **NOT** filter LOW-confidence rows. Real cold-start lots emit `confidence: LOW` by definition ([Reliability Scoring](#reliability-scoring)), and `cold_start_weight` is the mechanism for downweighting them at fit time. Filtering would eliminate the rows the weights were designed to handle, silently turning `cold_start_weight` into a no-op for real data. In contrast, `compute_baseline` **DOES** filter LOW by default — the baseline has no weighting mechanism, and a noisy baseline corrupts the Stage 2 deviation target directly.

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
- ~~Event impacts (spikes near campus events)~~ — removed 2026-04-30; events are a display/notification surface in mobile, not a model feature
- Noise and random fluctuations

### Source Tagging & Sample Weighting

Synthetic data includes a `source: "synthetic"` column that is **generator-only** — real Aurora snapshots do not have this column. When synthetic and real parquets are concatenated at training time, real rows will have `NaN` in the `source` column. This enables sample weighting to downweight synthetic data as real data accumulates (e.g., `{"synthetic": 0.3, "real": 1.0}`).

### Transition to Real Data

| Phase       | Source     | Notes                                              |
|-------------|------------|----------------------------------------------------|
| Now         | Seed data  | Prisma seed script generates 7 days of snapshots   |
| Post-launch | PostgreSQL | Real snapshots collected every 15min by scheduler   |
| Mature      | PostgreSQL | 60+ days of real data, synthetic for tests only     |




### Tuning as Real Data Accumulates

Several model parameters are currently hand-tuned heuristics that should be calibrated once sufficient real data is available:

| Parameter | Current Value | How to Calibrate |
|-----------|--------------|-----------------|
| `COLD_START_CI_MULTIPLIER` | 1.5 | Compare CI coverage (% of actuals within 10th-90th band) for cold-start vs established lots. Adjust until both groups achieve ~80% coverage. |
| `synthetic_weight` | 1.0 (default) | Sweep values (0.1–1.0) and compare test MAE. As real data grows, lower values should improve accuracy. |
| `cold_start_weight` | 1.0 (default) | Similar sweep; lower if cold-start data is noisy enough to hurt generalization. |
| `HOLDOUT_DAYS` | 14 | May need adjustment based on data volume — shorter holdout if data is scarce, longer if plentiful. |

**Long-term sample weight tuning:** The long-term model's Stage 2 XGBoost predicts residual deviations (actual − baseline), not raw occupancy rates. This means the signal-to-noise ratio is inherently lower — noisy synthetic or cold-start rows can bias the deviation model more easily than they would a raw-rate model. Expect `synthetic_weight` to need a lower value for long-term (e.g., 0.1–0.3) compared to short-term. Run a grid search over both weights once real data is available, evaluating on horizon-stratified MAE.

**Cross-semester baseline lookup (long-term):** Once a lot has a full semester of real data, extend `compute_baseline` in `src/features/long_term.py` to fall back per-lot across semesters for the same `academic_period` (e.g. use last fall's `dead_week` data for this fall's `dead_week` baseline). This fixes the period-boundary sparsity gap — short periods like `dead_week` and `finals` get at most 1-2 weeks in the 4-week window, often triggering the global `(day_of_week, hour)` fallback. Gate per-lot so immature lots stay on the global fallback until they catch up. Requires retaining snapshots beyond 4 weeks and adding a period-scoped fallback tier to `_lookup_baseline`.

**General progression:**
1. **Synthetic-only (now):** All defaults, no weighting needed. Baseline comparisons are synthetic-vs-synthetic (validates pipeline, not real accuracy).
2. **Hybrid (early real data):** Lower `synthetic_weight` (e.g., 0.3–0.5) to prefer real patterns while keeping synthetic for coverage. Baseline comparisons become meaningful — persistence and historical average baselines should be computed on real data only.
3. **Real-dominant (60+ days):** `synthetic_weight` near 0 or synthetic data dropped entirely; calibrate CI multiplier from observed error distributions. All baselines (persistence, historical average, same-day-last-week) are fully valid and the model must beat them to justify continued use.

**Baseline validation gates:**

Gates are based on **data coverage**, not calendar time. Coverage is measured as the percentage of `(lot_id, day_of_week, hour)` combinations that have at least N real (non-synthetic) observations. With 28 lots × 7 days × 15 hours = 2,940 total combinations:

| Coverage | Baseline Comparisons | Rationale |
|----------|---------------------|-----------|
| < 30% of combos with ≥2 observations | Skip baseline comparison | Too sparse — historical average would be unreliable |
| 30–60% with ≥2 observations | Persistence baseline only | Enough for "predict current stays the same" but not enough for historical patterns |
| > 60% with ≥4 observations | All baselines (persistence, historical average, same-day-last-week) | Sufficient coverage for meaningful pattern-based comparisons |

This approach is resilient to uneven rollouts (e.g., only 10 lots reporting), semester breaks, and sensor outages — it measures what the data actually covers rather than assuming consistent collection.

**Why aggregate coverage instead of per-lot?** There's one global XGBoost trained on all lots with `lot_id` as a categorical feature, so promotion is "promote this model or don't" — there's no concept of "promote for lot G4 but not A1." Per-lot coverage would require per-lot baseline evaluation and independent promotion decisions, adding complexity that only makes sense with per-lot models (see "Short-Term Predictions" above). The sample weighting system (`synthetic_weight`, `cold_start_weight`) already addresses per-lot data quality at training time.

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

The `semester` (`fall`, `spring`, `summer`, `session`, `break`) and `academic_period` (`early`, `regular`, `midterms`, `late`, `dead_week`, `finals`) features are derived from CSULB's academic calendar and are core features for both models — not a future addition. Campus closures (holidays, breaks) are also tracked via `is_campus_open`.

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
- `semester`: categorical (`fall`, `spring`, `summer`, `session`, `break`) — which term the date falls in. `session` covers winter/may intersessions.
- `academic_period`: categorical (`early`, `regular`, `midterms`, `late`, `dead_week`, `finals`) — derived from CSULB academic calendar.
  - `early`: first 2 weeks of classes (weeks 1-2) — students figuring out schedules and parking, higher churn
  - `regular`: standard class weeks outside early/midterm periods (weeks 3-7)
  - `midterms`: weeks 8-9 of classes — exam season with higher campus activity
  - `late`: weeks 10-14 — post-midterm stretch, stable patterns
  - `dead_week`: week 15 (last week of classes before finals) — reduced class activity, increased study patterns
  - `finals`: official finals week with altered schedules

> **Cold-start granularity note:** During cold start, we intentionally use more granular `academic_period` categories (6 periods instead of the typical early/regular/finals split). This lets us capture finer-grained occupancy patterns in synthetic data. As real data accumulates starting in the hybrid phase, we'll compare distributions across these periods — if adjacent periods (e.g., `regular` vs `late`) show statistically similar occupancy patterns, we can collapse them to reduce feature cardinality and improve model generalization.

### Long-term Features

**Stage 1 (Historical Baseline):**
- 4-week rolling average for `(lot_id, academic_period, day_of_week, hour)` combination
- Coverage fallback: groups with < 2 unique days use global `(day_of_week, hour)` mean
- Week-of-semester adjustment factor
- Historical variance (for confidence estimation)

**Stage 2 (XGBoost Adjustment):**
- `historical_baseline` (from Stage 1)
- `days_ahead` (1-7, critical for horizon-specific learning)
- `sin_hour`, `cos_hour`, `sin_day`, `cos_day` (cyclical time encodings)
- `week_of_semester` (1-16 during active semester, 0 outside semester)
- `semester`: categorical (`fall`, `spring`, `summer`, `session`, `break`)
- `academic_period`: categorical (`early`, `regular`, `midterms`, `late`, `dead_week`, `finals`)
- `is_campus_open`: boolean — false on holidays/closures (Labor Day, Thanksgiving, etc.)
- `lot_id` (categorical)
- Weather forecasts (future, days 1-5): `temperature_forecast`, `precipitation_prob`

**Key difference from short-term:** No lag features or current state. Week-ahead relies on patterns and calendar, not real-time conditions.

### Weekly Trend Feature (Planned — requires real data)

Once sufficient real data accumulates, a `weekly_trend` feature should be added to Stage 2:

- **Definition:** `mean(occupancy_rate over last 7 days for this lot) - historical_baseline` for the same `(day_of_week, hour)` slot
- **Signal:** Captures whether the current week is running hotter or cooler than the historical norm - e.g. a conference on campus all week, or an unusually quiet week
- **Why it enables tiered horizon targets:** With `weekly_trend`, Day 1-2 predictions get anchored to the current week's trend, while Day 6-7 must rely on the baseline alone. This creates a genuine accuracy gradient across horizons, making stricter near-term targets meaningful.

**When implementing:** add `compute_weekly_trend()` to `src/features/long_term.py`, wire it into both training and inference feature prep, add `"weekly_trend"` to `NUMERIC_FEATURES` in `src/models/long_term.py`, and revisit `HORIZON_MAE_TARGETS` in `src/evaluation/compare.py` to re-introduce tiered targets.

**Why cyclical encoding (`sin_hour`, `cos_hour`, `sin_day`, `cos_day`) is load-bearing for long-term:** Without lag features, XGBoost must learn time patterns purely from calendar context. Raw integer `hour` treats 23 and 0 as far apart numerically, but they're adjacent in time. Sin/cos encoding fixes this, making late-night/early-morning boundary patterns learnable. Short-term omits cyclical encoding entirely — lag features dominate there, and predictions run 7am–9pm so there is no wrap-around boundary to handle.

### Weather-Aware Forecasting

Weather is integrated through a **two-layer design**: a rule-based adjustment layer that ships now, and an eventual learned-feature layer that activates post-launch once real data exists.

#### Current state: rule-based adjustment for short-term predictions

**No learned coefficients.** Pre-launch occupancy is synthetic, so any model trained against synthetic occupancy paired with real weather would memorize fabricated correlations. The rule-based layer ships meaningful weather-awareness without requiring real data, and remains as a permanent safety floor even after a learned weather model eventually integrates — rare severe events (snow, thunderstorms) are systematically under-sampled by Empirical Risk Minimization training, so a hand-coded floor catches the tails the learned model misses.

**Severity classification (derived in code, no schema migration):**

| Severity | Trigger |
|---|---|
| `SEVERE` | `conditions` contains "thunderstorm" / "tornado" / "squall"; OR `wind_speed_mph > 40` |
| `SNOW` | `conditions` contains "snow" / "sleet" / "freezing rain" |
| `HEAVY_RAIN` | `is_raining` AND `precipitation_probability > 0.7` AND `conditions` contains "heavy" |
| `RAIN` | `is_raining` (default rain bucket) |
| `EXTREME_HEAT` | `temperature_f > 100` |
| `NORMAL` | none of the above |

Order matters: checks run most-severe to least-severe, so a thunderstorm with rain classifies as `SEVERE`, not `RAIN`.

**Adjustment rules (per prediction row, using `target_hour`):**

| Severity | Adjustment |
|---|---|
| `SEVERE` | `median *= 0.5`, lower bound widened to `min(lower, median * 0.7)` |
| `SNOW` | `median *= 0.75`, lower bound widened similarly |
| `HEAVY_RAIN` + commute hour (7-9, 16-18) | `median *= 1.05` (drive instead of walk) |
| `HEAVY_RAIN` + non-commute | `median *= 0.97` |
| `RAIN` + commute | `median *= 1.02` |
| `RAIN` + non-commute | no-op |
| `EXTREME_HEAT` | no-op |
| `NORMAL` | no-op |

All outputs clipped to `[0, 1]`. The `lower ≤ median ≤ upper` invariant is preserved after adjustment. Widening is one-sided — only the lower bound is pushed down, never the upper — severe weather is hypothesized to push parking demand down.

**Both the directions and magnitudes of these adjustments are documented placeholders, not measured.** They encode plausible-sounding hypotheses about how weather affects parking demand on this specific campus, but every rule — including the sign of the rain bump and the no-op for extreme heat — could be wrong. 

**Failure mode:** if the `weather` table is empty or unreachable, `fetch_latest_weather()` returns `None`, the adjustment layer is a no-op, and predictions ship unchanged with a `NO_WEATHER_DATA` log entry. The kill-switch `WEATHER_ADJUSTMENT_ENABLED` in `src/config.py` disables the layer entirely if rules misfire in production.

#### Eventual learned-weather integration (post-launch)

Once post-launch data accumulates enough coverage to support learning — at minimum one full academic semester, with 30+ rainy days and 10+ extreme-temperature days observed across lots — evaluate whether to integrate weather as model features. Severe weather (snow, thunderstorms, high wind) is intentionally out of scope for the learned layer: those events are too rare for ERM to fit reliably even with years of data, and the rule-based layer remains their permanent home.

The rule-based adjustment layer **stays permanent** under the learned model as a safety floor for severe events.

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
| `occupancy_events` | Raw ENTER/EXIT events | 30 days (daily prune cron, see infrastructure/README.md) |
| `predictions_short_term` | Short-term predictions (hourly by lot) | Overwritten each cycle |
| `predictions_long_term` | Week-ahead predictions (7 days × hourly by lot) | Overwritten daily |

> **Note:** Unlike DynamoDB's TTL-based cleanup, PostgreSQL data is retained permanently. For cost management at scale, older `occupancy_snapshots` and `occupancy_events` rows should be archived to S3 and pruned periodically.

**Volume estimates:**

- Snapshots: ~2,688 records/day (28 lots × 96 snapshots/day)
- Short-term predictions: ~2,688 records/day (28 lots × 96 predictions/day)
- Long-term predictions: ~2,744 records/day (28 lots × 7 days × 14 hours)

### Training Data Archive (S3)

**Current approach:** Training data (parquet) is logged as an MLflow artifact with each run, so any past run's exact dataset can be downloaded via `mlflow.artifacts.download_artifacts(run_id=..., artifact_path="data")`. This is fine while data is small (single-digit MBs). Once data grows past ~100MB, switch to versioned S3 storage and log a hash or version reference instead of the full file.

PostgreSQL retains data permanently, but archiving older data to S3 reduces database size and enables efficient batch queries for model training.

| S3 Path                          | Source Table              | Retention | Purpose                              |
|----------------------------------|---------------------------|-----------|--------------------------------------|
| `s3://sharkpark-ml/occupancy/`   | `occupancy_snapshots`     | Permanent | Historical occupancy for retraining  |
| `s3://sharkpark-ml/weather/`     | `weather`                 | Permanent | Weather correlation analysis         |
| ~~`s3://sharkpark-ml/events/`~~      | ~~`campus_events` + `event_impacts`~~ | — | **Removed 2026-04-30:** events are a mobile display/notification context layer, not an ML feature. No archive needed. |
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

> **Open question — model-specific thresholds:** Short-term has lag features and current state, so its MAE floor is inherently lower than long-term. A 5% MAE improvement means something different for a state-transition model vs a calendar-only model. Short-term may warrant a higher bar (e.g., 10%). However, with sparse or mostly synthetic data, MAE scores are too noisy to reason about thresholds reliably. **Revisit once the first real training run passes the full baseline gate (`COVERAGE_ALL_THRESHOLD = 60%`)** — at that point, observed MAE variance across runs will inform what a meaningful improvement actually looks like.

> **Fair comparison:** The evaluation script (`evaluate.py`) re-evaluates the production model on the candidate's test set, so both models are always compared on identical data. This avoids data drift bias when retraining on newer data.


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

**Long-term horizon MAE targets (promotion gate):**
All horizons use a flat < 0.15 target. The long-term model is calendar-only (no same-day lag features), so it has no informational advantage at Day 1 vs Day 7 — the prediction is equally difficult at any horizon. Tiered targets (stricter at Day 1) only make sense for models with current-state anchoring. Revisit if the architecture gains a same-day snapshot input.

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