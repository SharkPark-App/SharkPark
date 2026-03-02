# SharkPark ML Service

Parking occupancy prediction models for CSULB students.

## Table of Contents

- [Overview](#overview)
- [Structure](#structure)
- [Setup](#setup)
- [Workflow](#workflow)
- [Local Development](#local-development)
- [API Endpoints (planned)](#api-endpoints-planned)
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
│   ├── config.py              # Operating hours, snapshot settings
│   ├── data/
│   │   ├── synthetic.py       # Cold-start data generation
│   │   └── real.py            # Real data loader from PostgreSQL
│   ├── features/
│   │   ├── base.py            # Shared utilities (time encoding, validation)
│   │   ├── short_term.py      # Lag features, momentum, current state
│   │   └── long_term.py       # Historical baseline, semester patterns (planned)
│   ├── models/
│   │   ├── short_term.py      # XGBoost regression with quantile CI
│   │   ├── long_term.py       # Two-stage hybrid (planned, not yet implemented)
│   │   └── baselines.py       # Naive baselines for comparison
│   ├── evaluation/
│   │   ├── metrics.py         # MAE, RMSE, MAPE
│   │   └── compare.py         # Model vs baseline vs production
│   ├── promotion/
│   │   └── registry.py        # MLflow registration, S3 export
│   └── api/                   # (planned) FastAPI endpoints for local dev/debugging
├── scripts/
│   ├── train.py               # Train a new model
│   ├── evaluate.py            # Compare against baselines + production
│   ├── promote.py             # Register winning model
│   └── predict.py             # Batch inference, writes to PostgreSQL
├── data/                      # Generated data artifacts (gitignored parquets)
├── tests/                     # Unit and integration tests
├── mlruns/                    # MLflow tracking (gitignored)
├── pyproject.toml
└── README.md
```

## Setup

```bash
cd services/ml
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -e ".[dev]"
```


## Workflow

### 0. Generate synthetic data (cold-start)
```bash
python -m src.data.synthetic                                        # Generate Fall 2025 (default)
python -m src.data.synthetic --semester spring-2026                  # Generate Spring 2026
```
Generates synthetic occupancy snapshots for each parking lot at 15-minute intervals across the specified semester. Fetches lot metadata (IDs, capacities, types) from PostgreSQL and outputs a parquet file to `data/`.

The `--semester` flag accepts `{term}-{year}` where year is the calendar year the term occurs in. Valid terms: `fall`, `spring`.

> **Note:** You only need to run this once per semester. Re-run only if you change the synthetic data generator or want a different seed. To combine semesters, run once per semester with different `--output` paths and concatenate the parquets.

Options:
```bash
python -m src.data.synthetic --semester fall-2025 --preview 10      # Preview 10 sample records per lot type
python -m src.data.synthetic --output data/custom.parquet           # Custom output filename
python -m src.data.synthetic --max-records-per-lot 5000             # Downsample to fewer records per lot
python -m src.data.synthetic --seed 123                             # Different random seed (default: 42)
```

Requires PostgreSQL to be running with seeded lot data. 
Set `DATABASE_URL` for local PostgreSQL (default: `postgresql://sharkpark:sharkpark@localhost:5433/sharkpark`).

> Output includes an `is_cold_start: true` flag for the training pipeline to distinguish synthetic from real data during the blended transition phase.
----
### 1. Train a model

```bash
python -m scripts.train
python -m scripts.train --data-path data/custom.parquet
python -m scripts.train --model-type long-term                          # (planned) Long-term model
```

Trains on synthetic data, logs experiment to `mlruns/`. Prints the MLflow run ID and metrics (MAE, RMSE, MAPE).

> `--model-type` is planned — currently only `short-term` (default) is supported.

(PLANNED) To mix real data from PostgreSQL with synthetic data:
```bash
python -m scripts.train --include-real                                  # All synthetic + all real
python -m scripts.train --include-real --synthetic-ratio 0.3            # 30% synthetic, 70% real
python -m scripts.train --include-real --real-start-date 2025-08-01     # Real data from a specific date
python -m scripts.train --include-real --real-end-date 2025-12-01       # Real data up to a date
```

----
### 2. Evaluate

```bash
python -m scripts.evaluate --run-id <mlflow-run-id>
python -m scripts.evaluate --run-id <mlflow-run-id> --data-path data/custom.parquet
python -m scripts.evaluate --run-id <mlflow-run-id> --model-type long-term  # (planned)
```

Compares candidate model against:
- **Baselines**: Persistence, majority class
- **Production**: Current deployed model (if one exists)

Promotion criteria:
- Must beat all baselines (lower MAE) AND
- Reduce MAE by ≥5% vs production OR improve directional accuracy by ≥3pp
- Evaluated on held-out test set from most recent 2 weeks


----
### 3. Promote (if candidate wins)

```bash
python -m scripts.promote --run-id <mlflow-run-id>
python -m scripts.promote --run-id <mlflow-run-id> --model-type long-term   # (planned)

# Later, when deploying to Lambda:
python -m scripts.promote --run-id <mlflow-run-id> --export-s3
```

Registers the model in MLflow as `short-term-production` (or `long-term-production` when implemented) and transitions it to the Production stage.

-----
### 4. Predict (batch inference)

```bash
python -m scripts.predict                              # Write predictions to PostgreSQL (default)
python -m scripts.predict --start-of-day               # Predict all hours (7-21)
python -m scripts.predict --csv                        # Also write to local CSV
python -m scripts.predict --csv --output data/preds.csv
python -m scripts.predict --csv --format parquet
python -m scripts.predict --model-type long-term       # (planned)
```
- Loads the latest production model, builds inference features, and writes predictions to PostgreSQL (`predictions_short_term` table). 
- Use `--csv` to also write a local file. Confidence intervals are generated via quantile regression (10th/90th percentile).
---
### 5. Rollback (planned)

```bash
python -m scripts.promote --run-id <previous-run-id>
```

## Local Development

MLflow UI:
```bash
mlflow ui
# Open http://localhost:5000
```

> **Non-local tracking:** MLflow runs locally (`mlruns/`) and doesn't need a remote server until more people are working on ML and need to share experiments. When that happens, set `MLFLOW_TRACKING_URI` to a remote server — no code changes needed.

## API Endpoints (planned)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/predict/short-term` | Get hourly predictions for a lot |
| POST | `/predict/long-term` | Get 7-day predictions for a lot |
| GET | `/health` | Health check |

On-demand predictions during local development and testing. Useful for debugging individual lot predictions without running the full batch pipeline. 
> Not required for production — batch scripts write predictions directly to PostgreSQL, and the backend reads from there.

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
| Long-term | MAE (horizon-stratified) | Day 1-2: <10%, Day 3-5: <15%, Day 6-7: <25% |

Secondary metrics: RMSE, MAPE, day-ahead accuracy.

Models must beat all naive baselines (persistence, majority class) on MAE as a hard gate before promotion criteria are evaluated. Historical average and same-day-last-week baselines will be added when long-term model is implemented.

## Cold Start

At launch with no historical data, the system transitions through three phases. Exact timelines depend on data volume and sensor rollout:

| Phase | Short-term | Long-term |
|-------|-----------|-----------|
| Early (synthetic only) | Synthetic-trained model; predictions improve as real data accumulates | Baseline uses synthetic patterns + early real data; confidence = LOW |
| Transitional (blended) | Blending synthetic + real data | Baseline uses accumulated real data; XGBoost learns real deviations; confidence = MED |
| Mature (real data) | Full reliance on real data | Full reliance on accumulated real data; confidence = HIGH (if MAE meets targets) |

## Deployment (Future)

| Concern | Local | Deployed |
|---------|-------|----------|
| What runs inference | Manual script | Lambda (scheduled) |
| Trigger | Manual | EventBridge (every 15 min short-term, daily long-term) |
| Model loaded from | `mlruns/` | S3 |
| Model tracking | MLflow (local) | MLflow (local) |
| Training data source | PostgreSQL (Docker) | Aurora PostgreSQL Serverless v2 |
| Training data archive | Local files | S3 (Parquet, partitioned by date) |
| Prediction output | PostgreSQL (Docker) | Aurora PostgreSQL Serverless v2 |

The prediction logic (`src/models/`, `src/features/`) stays the same—only the entrypoint changes. Later add `lambda_handler.py` that reuses the same code.

**Retraining:** Weekly retrain job (manual script for now, Lambda later). Candidate model compared against production; promoted only if it meets promotion criteria.
## Linting & Formatting

[Ruff](https://docs.astral.sh/ruff/) for both linting and formatting.

```bash
# Check for lint errors
ruff check .

# Auto-fix lint errors
ruff check . --fix

# Format code
ruff format .

# Check formatting without changing files
ruff format . --check
```

## Testing

Run a specific test file:
```bash
cd services/ml
python -m pytest tests/data/test_synthetic.py -v
```

Run all tests:
```bash
python -m pytest tests/ -v
```

Run tests with coverage report:
```bash
# Terminal report showing coverage percentage
python -m pytest tests/ --cov=src --cov=scripts --cov-report=term-missing
```

## Notes
- Retraining: Weekly (manual for now, Lambda later)
- Lot metadata pulled from PostgreSQL
- Models stored locally in `mlruns/` during development
- Database: PostgreSQL 16 (Docker) locally, Aurora PostgreSQL Serverless v2 in production — managed by Prisma ORM
- **Run ID handoff**: The workflow is sequential 
    -  `train` outputs an MLflow run ID, which you manually pass to `evaluate`, then to `promote`. 
    - This will be automated when Lambda + EventBridge is set up (train → evaluate → promote chained automatically).
- S3 not used yet — only needed when deploying inference to Lambda.
- ML training queries run as native SQL (JOINs with `lots`, `academic_calendar`, `campus_events` tables)
- XGBoost model must be <50MB for Lambda deployment (typical: ~5-15MB)