# SharkPark ML Service

Parking occupancy prediction models for CSULB students.

## Table of Contents

- [Overview](#overview)
- [Structure](#structure)
- [Setup](#setup)
- [Workflow](#workflow)
- [Local Development](#local-development)
- [Data Flow](#data-flow)
- [Integration](#integration)
- [Metrics](#metrics)
- [Cold Start](#cold-start)
- [Deployment (Future)](#deployment-future)
- [Linting & Formatting](#linting--formatting)
- [Testing](#testing)
- [Notes](#notes)

## Overview

Two prediction systems:

| Model | Purpose | Runs | Output |
|-------|---------|------|--------|
| Short-term | "What will this lot look like at 2pm?" | Every 15 min | Hourly occupancy per lot (7am-9pm) |
| Long-term | "What will Lot G2 look like next Thursday at 10am?" | Daily | Per-lot hourly occupancy for next 7 days |

See [Model_Design.md](Model_Design.md) for technical decisions and rationale.

## Structure

```
services/ml/
├── src/
│   ├── academic_calendar.py   # Rule-based academic calendar
│   ├── config.py              # Operating hours (7–21 PT), snapshot settings, CAMPUS_TZ
│   ├── data/
│   │   ├── synthetic.py       # Cold-start data generation
│   │   └── db.py              # PostgreSQL read/write (snapshots, predictions)
│   ├── features/
│   │   ├── base.py            # Shared utilities (time encoding, validation)
│   │   ├── short_term.py      # Lag features, momentum, current state
│   │   └── long_term.py       # Historical baseline + XGBoost deviation features
│   ├── models/
│   │   ├── short_term.py      # XGBoost regression with quantile CI
│   │   ├── long_term.py       # Two-stage hybrid (baseline + XGBoost deviation)
│   │   └── baselines.py       # Naive baselines for comparison
│   ├── postprocess/
│   │   ├── cold_start_floor.py     # MIN_FLOOR_RATE clamp (mirrors backend constants)
│   │   ├── low_activity_scaling.py # Scale-down during low-activity academic periods
│   │   └── weather_adjustment.py   # Weather-driven demand modifier
│   ├── promotion/             # Model-promotion helpers
│   ├── utils/
│   │   ├── mlflow_setup.py    # configure_mlflow() — call before any MLflow run/log
│   │   ├── mlflow_utils.py    # MLflow run/artifact helpers
│   │   └── promotion_guard.py # Production-promotion safety gates
│   └── evaluation/
│       ├── metrics.py         # MAE, RMSE, MAPE
│       └── compare.py         # Model vs baseline vs production
├── scripts/
│   ├── train_short_term.py             # Train a new short-term model
│   ├── evaluate_short_term.py          # Evaluate short-term candidate vs baselines + production
│   ├── promote_short_term.py           # Register winning short-term model
│   ├── predict_short_term.py           # Short-term batch inference, writes to PostgreSQL
│   ├── check_short_term_predictions.py # Inspect predictions_short_term rows
│   ├── train_long_term.py              # Train a new long-term model
│   ├── evaluate_long_term.py           # Evaluate long-term candidate vs baselines + production
│   ├── promote_long_term.py            # Register winning long-term model
│   ├── predict_long_term.py            # Long-term batch inference, writes to PostgreSQL
│   ├── check_long_term_predictions.py  # Inspect predictions_long_term rows
│   ├── ingest_csulb_catalog.py         # Pull CSULB course catalog (academic-load features)
│   ├── ingest_room_capacities.py       # Pull classroom capacities (academic-load features)
│   ├── build_proximity_matrix.py       # Lot↔lot proximity used for nearby-event impact
│   ├── recompute_penetration_rates.py  # Backfill penetration rates on snapshots
│   ├── generate_synthetic_v2.py        # Newer synthetic-data generator
│   ├── validate_synthetic_v2.py        # Validate generated synthetic data
│   └── bootstrap_mlflow.py             # First-time MLflow store bootstrap
├── data/                      # Generated data artifacts (gitignored parquets)
├── tests/                     # Unit and integration tests
├── mlruns/                    # MLflow tracking (gitignored)
├── pyproject.toml
└── README.md
```

### How this service fits into SharkPark

ML is invoked **by the backend cron**, not directly by the API or the
mobile app. The data flow is:

1. The backend `snapshot.job` writes a row per lot every 15 min into
   `LotSnapshot` (Postgres). This is the only training input.
2. Backend cron jobs `predict-short-term.job` and `predict-long-term.job`
   shell out to `predict_short_term.py` / `predict_long_term.py` here.
3. Those scripts read recent snapshots, run the XGBoost model loaded from
   MLflow, apply [`postprocess/cold_start_floor.py`](src/postprocess/cold_start_floor.py),
   and write rows into `predictions_short_term` / `predictions_long_term`.
4. When the mobile app hits `/api/v1/lots/:id/predictions/short-term`, the
   backend's `LotsService` reads the freshest matching row and tags the
   response `source: 'ml'`. If no fresh row exists, it falls back to a
   server-side time-of-day heuristic and tags `source: 'heuristic'`.

So the contract between this service and the backend is simply:
*snapshots in via shared Postgres, predictions out via shared Postgres,
plus a single-line `ML_RESULT {...}` JSON marker on stdout that the cron
runner parses for run metadata and drift detection*.

## Setup

**1. Install uv** (if not already installed):

```bash
# Windows (PowerShell):
irm https://astral.sh/uv/install.ps1 | iex

# macOS/Linux:
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**2. Install dependencies:**

```bash
cd services/ml
uv sync
```

No activation needed — prefix all commands with `uv run` and it handles the environment automatically.


## Workflow

### 0. Generate synthetic data (cold-start)
```bash
uv run python -m src.data.synthetic                                        # → data/synthetic_fall-2025.parquet
uv run python -m src.data.synthetic --semester spring-2026                  # → data/synthetic_spring-2026.parquet
```
Generates synthetic occupancy snapshots for each parking lot at 15-minute intervals across the specified semester. Fetches lot metadata (IDs, capacities, types) from PostgreSQL and outputs a parquet file to `data/`.

The `--semester` flag accepts `{term}-{year}` where year is the calendar year the term occurs in. Valid terms: `fall`, `spring`.

> **Note:** One semester of synthetic data is sufficient for cold-start (patterns are identical across semesters). Multi-semester glob support exists for when real data accumulates and fall-vs-spring differences matter. Re-run only if you change the generator or want a different seed.

Options:
```bash
uv run python -m src.data.synthetic --semester fall-2025 --preview 10      # Preview 10 sample records per lot type
uv run python -m src.data.synthetic --output data/custom.parquet           # Custom output filename
uv run python -m src.data.synthetic --max-records-per-lot 5000             # Downsample to fewer records per lot
uv run python -m src.data.synthetic --seed 123                             # Different random seed (default: 42)
```

Requires PostgreSQL to be running with seeded lot data. 
Set `DATABASE_URL` for local PostgreSQL (default: `postgresql://sharkpark:sharkpark@localhost:5433/sharkpark`).

> Output includes an `is_cold_start: true` flag and a `source: "synthetic"` column. The `source` column is generator-only (absent in real Postgres data) and is used at training time to apply sample weights when blending synthetic and real data — rows without it are treated as real.
----
### 1. Train a model

**Short-term:**
```bash
uv run python -m scripts.train_short_term                                                 # All data/synthetic_*.parquet files
uv run python -m scripts.train_short_term --data-path data/synthetic_fall-2025.parquet    # Single file
uv run python -m scripts.train_short_term --data-path "data/synthetic_*.parquet"          # Glob pattern (multiple semesters)
```

**Long-term:**
```bash
uv run python -m scripts.train_long_term                                       # All data/synthetic_*.parquet files
uv run python -m scripts.train_long_term --data-path data/synthetic_fall-2025.parquet
```

Trains on synthetic data, logs experiment to `mlruns/`. Prints the MLflow run ID and metrics.

To mix real data from PostgreSQL with synthetic data:
```bash
uv run python -m scripts.train_short_term --include-real                                  # All synthetic + all real
uv run python -m scripts.train_short_term --include-real --synthetic-weight 0.3            # Synthetic data at 30% influence
uv run python -m scripts.train_short_term --include-real --real-start-date 2025-08-01     # Real data from a specific date
uv run python -m scripts.train_short_term --include-real --real-end-date 2025-12-01       # Real data up to a date
```

----
### 2. Evaluate

**Short-term:**
```bash
uv run python -m scripts.evaluate_short_term --run-id <mlflow-run-id>
uv run python -m scripts.evaluate_short_term --run-id <mlflow-run-id> --data-path data/custom.parquet  # override data
```

**Long-term:**
```bash
uv run python -m scripts.evaluate_long_term --run-id <mlflow-run-id>
uv run python -m scripts.evaluate_long_term --run-id <mlflow-run-id> --data-path data/custom.parquet
```

By default, downloads the training data artifact from the MLflow run. Use `--data-path` to override with a different dataset.

Compares candidate model against:
- **Baselines**: Persistence, majority class
- **Production**: Current deployed model (if one exists)

Promotion criteria:
- Must beat all baselines (lower MAE) AND
- Reduce MAE by ≥5% vs production OR improve directional accuracy by ≥3pp
- Evaluated on held-out test set from most recent 2 weeks


----
### 3. Promote (if candidate wins)

**Short-term:**
```bash
uv run python -m scripts.promote_short_term --run-id <mlflow-run-id>

# Also publish artifacts to Cloudflare R2 (required before the prediction job can load this version):
uv run python -m scripts.promote_short_term --run-id <mlflow-run-id> --export-s3

# Re-publish an already-registered version without re-promoting:
uv run python -m scripts.promote_short_term --upload-only <version>
```

**Long-term:**
```bash
uv run python -m scripts.promote_long_term --run-id <mlflow-run-id>
```

Registers the model in MLflow as `short-term-production` or `long-term-production` and sets the production alias.

-----
### 4. Predict (batch inference)

**Short-term:**
```bash
uv run python -m scripts.predict_short_term                                        # Write predictions to PostgreSQL (default)
uv run python -m scripts.predict_short_term --data-path data/custom.parquet        # Use parquet instead of DB
uv run python -m scripts.predict_short_term --start-of-day                         # Predict all hours (7-21), use for scheduled/nightly runs
uv run python -m scripts.predict_short_term --write-local                          # Also write to local CSV
uv run python -m scripts.predict_short_term --write-local --output-path data/preds.csv
```

**Long-term:**
```bash
uv run python -m scripts.predict_long_term                              # Write 7-day predictions to PostgreSQL
uv run python -m scripts.predict_long_term --data-path data/custom.parquet
uv run python -m scripts.predict_long_term --days-ahead 3               # Only next 3 days
uv run python -m scripts.predict_long_term --write-local                # Also write to local CSV
```
- Loads the latest production model, builds inference features, and writes predictions to PostgreSQL (`predictions_short_term` or `predictions_long_term` table).
- Use `--write-local` to also save a local CSV. Confidence intervals are generated via quantile regression (10th/90th percentile).

> **Local dev:** Without `--data-path`, predict fetches live snapshots from PostgreSQL (last 2 hours). This requires the backend scheduler to be running. For local testing with synthetic data, always pass `--data-path`.
---
### 5. Rollback (planned)

```bash
uv run python -m scripts.promote_short_term --run-id <previous-run-id>
```

## Local Development

MLflow UI:
```bash
uv run mlflow ui
# Open http://localhost:5000
```

> **Non-local tracking:** MLflow runs locally (`mlruns/`) and doesn't need a remote server until more people are working on ML and need to share experiments. When that happens, set `MLFLOW_TRACKING_URI` to a remote server — no code changes needed.

## Data Flow

### Short-term
```
PostgreSQL (occupancy_snapshots)
    ↓ occupancy snapshots
src/features/short_term.py
    ↓ lag features, momentum, current state
src/models/short_term.py (XGBoost regression + quantile CI)
    ↓ predictions + confidence intervals
PostgreSQL (predictions_short_term)
    ↓ backend reads
Mobile app
```

### Long-term
```
PostgreSQL (occupancy_snapshots + academic_calendar)
    ↓ historical occupancy data + calendar context
src/features/long_term.py
    ↓ Stage 1: 4-week rolling avg per (lot, day_of_week, hour)
    ↓ Stage 2: XGBoost features (baseline, days_ahead, week_of_semester)
src/models/long_term.py (Two-stage hybrid)
    ↓ predicted_occ = historical_baseline + xgboost_adjustment
PostgreSQL (predictions_long_term)
    ↓ backend reads
Mobile app
```

## Integration

ML runs as a batch job, not on-demand:

1. Scheduled trigger (every 15 min for short-term, daily for long-term)
2. ML writes predictions to PostgreSQL (`predictions_short_term` / `predictions_long_term` tables)
3. Backend reads from PostgreSQL when mobile app requests (via Prisma ORM)

Backend and ML never communicate directly. ML queries training data with native SQL (JOINs, window functions, aggregations) — no export pipeline required.

## Metrics

| Model | Primary Metric | Target |
|-------|----------------|--------|
| Short-term | MAE | < 10% of lot capacity |
| Long-term | MAE (horizon-stratified) | Day 1-2: <10%, Day 3-5: <15%, Day 6-7: <25% (planned; current gate: <15% flat) |

Secondary metrics: RMSE, MAPE, day-ahead accuracy.

Models must beat all active baselines on MAE as a hard gate before promotion criteria are evaluated. Which baselines are active depends on real data coverage — see [Baseline validation gates](Model_Design.md#baseline-validation-gates) for details.

## Cold Start

At launch with no historical data, the system transitions through three phases. Exact timelines depend on data volume and sensor rollout:

| Phase | Short-term | Long-term |
|-------|-----------|-----------|
| Early (synthetic only) | Synthetic-trained model; predictions improve as real data accumulates | Baseline uses synthetic patterns + early real data; confidence = LOW |
| Transitional (blended) | Blending synthetic + real data | Baseline uses accumulated real data; XGBoost learns real deviations; confidence = MED |
| Mature (real data) | Full reliance on real data | Full reliance on accumulated real data; confidence = HIGH (if MAE meets targets) |

### Cold-start floor (`postprocess/cold_start_floor.py`)

During the cold-start window, both the backend's live tile and the ML
forecasts are clamped to a shared `MIN_FLOOR_RATE` so the displayed numbers
stay consistent across endpoints. The constants are mirrored exactly between
the backend ([`apps/backend/src/constants.ts`](../../apps/backend/src/constants.ts))
and this module:

| Constant | Value | Purpose |
|----------|-------|---------|
| `MIN_FLOOR_RATE` | `0.15` | Default occupancy floor during cold-start |
| `LOW_ACTIVITY_FLOOR_RATE` | `0.05` | Reduced floor for low-activity academic periods (`winter_session`, `summer_session`, `break`) |

Key functions:

- `is_cold_start_window(snapshots)` — returns `True` for empty data, missing
  `is_cold_start` column, or all rows flagged cold (NaN treated as cold).
- `apply_cold_start_floor(median, lower, upper, target_dates, target_hours, *, is_cold_start)`
  — no-op when not cold-start; otherwise clamps to the floor while preserving
  the `lower ≤ median ≤ upper` invariant. Outside operating hours (7–21 PT)
  the prediction is forced to `0.0` with reason `NORMAL`.

Both `predict_short_term.py` and `predict_long_term.py` call this module
before writing predictions. The short-term script converts UTC timestamps to
`CAMPUS_TZ` (`America/Los_Angeles`) before deriving the operating-hour and
floor-application date so late-evening PT predictions land in the correct
campus-local window.

### `ML_RESULT` markers

Prediction scripts print a single `ML_RESULT {...}` JSON line that the backend
cron runner parses to track ML run metadata. Statuses:

| Status | When |
|--------|------|
| `SUCCESS` | Predictions written. Includes `model_version`, `predictions_written`, `lots`, `cold_start_floor_active`. |
| `SKIPPED` | No prediction work to do (e.g. `no_prediction_hours_remaining` past end of operating day). Includes `reason`. |
| `FAILURE` | Raised on uncaught exceptions; the cron runner surfaces this to Sentry. |

The backend cron runner uses the `model_version` field to detect drift: every
successful ML run is compared against the previous one for the same job, and a
differing version emits a Sentry warning (without failing the job).

## Deployment (Future)

| Concern | Local | Deployed |
|---------|-------|----------|
| What runs inference | Manual script | Fly cron VM (scheduled) |
| Trigger | Manual | Cron (every 15 min short-term, daily long-term) |
| Model loaded from | `mlruns/` | Cloudflare R2 (via `production.json` pointer) |
| Model tracking | MLflow (local) | MLflow (local) |
| Training data source | PostgreSQL (Docker) | Neon Postgres 17 (pooled) |
| Training data archive | Local files | S3 (Parquet, partitioned by date) |
| Prediction output | PostgreSQL (Docker) | Neon Postgres 17 (pooled) |

The prediction logic (`src/models/`, `src/features/`) stays the same—only the entrypoint changes.

**Retraining:** Weekly retrain job (manual script for now, scheduled later). Candidate model compared against production; promoted only if it meets promotion criteria.
## Linting & Formatting

[Ruff](https://docs.astral.sh/ruff/) for both linting and formatting.

```bash
# Check for lint errors
uv run ruff check .

# Auto-fix lint errors
uv run ruff check . --fix

# Format code
uv run ruff format .

# Check formatting without changing files
uv run ruff format . --check
```

## Testing

Run a specific test file:
```bash
cd services/ml
uv run pytest tests/data/test_synthetic.py -v
```

Run all tests:
```bash
uv run pytest tests/ -v
```

Run tests with coverage report:
```bash
# Terminal report showing coverage percentage
uv run pytest tests/ --cov=src --cov=scripts --cov-report=term-missing
```

## Notes
- Retraining: Weekly (manual for now, scheduled later)
- Lot metadata pulled from PostgreSQL
- Models stored locally in `mlruns/` during development; promoted versions also published to Cloudflare R2 via `--export-s3` (see [.env.example](.env.example) for required R2 credentials).
- Database: PostgreSQL 17 (Docker) locally, Neon Postgres 17 (pooled endpoint, `pgbouncer=true`) in production — managed by Prisma ORM
- **Run ID handoff**: The workflow is sequential
    -  `train` outputs an MLflow run ID, which you manually pass to `evaluate`, then to `promote` (if applicable).
    - This will be automated once training runs on a schedule (train → evaluate → promote chained automatically).
- ML training queries run as native SQL (JOINs with `lots`, `academic_calendar`, `campus_events` tables)
- Each promoted version uploads ~4 MB to R2 (the four artifact files combined); no special size constraints for the Fly cron VM that loads them.