# SharkPark — F-tier demo deck (one slide per workstream)

> Source-of-truth doc for the live demo. Each section is a single slide:
> three to five bullets, **before / after** numbers, and the dashboard
> screenshot the audience will see live.
>
> All "after" numbers below are computed against the development DB seeded
> by `apps/backend/prisma/seed.ts` plus one week of synthetic v2 occupancy.
> Refresh them by re-running each workstream's validation script the
> morning of the demo (commands at the bottom of every slide).

---

## Slide 1 — B · Contributor consensus → ground truth

**Problem before B:**
- Single-device pings were treated as ground truth. A flaky phone in
  cell-only mode could move a lot's posted occupancy by 30+ spaces.
- No agreement signal → ML training silently absorbed adversarial /
  misconfigured devices.

**What B shipped:**
- `consensus_observations` table: 5-min UTC buckets, per-lot, with
  `contributor_count`, `agreement_score`, `is_ground_truth`.
- Computed inline in the existing 15-min `snapshot.job` (no new cron).
- Backfill script walked 90 days of `occupancy_events` idempotently.

**Before / after (last 14 days, dev DB):**

| Metric                                          | Before | After |
| ----------------------------------------------- | ------ | ----- |
| Snapshots usable as training labels             | 100%   | only `is_ground_truth=true` rows (~62%) |
| Median contributor_count for accepted snapshots | 1      | 4 |
| Outlier-induced occupancy swings ≥ 20 spaces    | 11     | 0 |

**Live evidence:**
- `GET /api/admin/consensus/G1?date=2026-05-05` shows the day's
  bucket-level table with `agreement_score` per window.
- Recompute on demand:
  `cd apps/backend && pnpm tsx src/scripts/backfill-consensus.ts --since 1d`

---

## Slide 2 — C · Self-improving penetration rate

**Problem before C:**
- Penetration rate was a single hardcoded constant per (dow_bucket,
  hour_bucket) pulled from a Sept 2025 staff survey. Lots with high
  app penetration were under-scaled; low-penetration lots over-scaled.

**What C shipped:**
- `penetration_rate_estimates` (lot × dow_bucket × hour_bucket) with
  EWMA + Welford variance.
- Daily 02:30 PT cron `recompute-penetration-rates` (NestJS scheduler →
  `services/ml/scripts/recompute_penetration_rates.py`).
- Blend rule: `0.7 * learned + 0.3 * rule` once `sample_count ≥ 30` and
  `last_updated` is within 14 days; otherwise rule.
- Feature flag `PENETRATION_RATE_LEARNING_ENABLED` (default OFF in dev,
  flipped ON for the demo).

**Before / after (dev DB, lot G1):**

| Metric                                | Before | After |
| ------------------------------------- | ------ | ----- |
| Posted occupancy MAE vs ground truth  | 0.142  | 0.084 |
| Buckets with learned-blendable estimates | 0   | 36 / 72 |
| Lots with stale estimates (> 14 d)    | n/a    | 0 |

**Live evidence:**
- `GET /api/admin/penetration-rate/G1` — full 3 × 24 grid, learned
  vs rule, sample_count, last_updated.
- Dashboard EWMA panel surfaces the same data for every lot.

---

## Slide 3 — D · Catalog-driven synthetic data v2 (HEADLINE)

**Problem before D:**
- v1 synthetic generator used per-lot sinusoids tuned by hand. It
  produced plausible but pattern-less data; XGBoost overfit it and
  got worse at real-world hour-of-day shape than the historical-baseline
  fallback.

**What D shipped:**
- D1: `course_meetings` table + CSULB Schedule-of-Classes scraper
  (public HTML, no auth). 1 manual run per term.
- D2: lot ↔ building walking-distance matrix (OSRM with haversine·1.4
  fallback), filtered to ≤ 8 min walk.
- D3: `synthetic_v2.SyntheticV2Generator` — Plackett-Luce lot choice,
  per-class arrival/departure pulses, calendar overlay, gaussian noise.
- D5: tier-weighted training (`real_clean` 10× / `real_cold` 10× /
  `synthetic_v2` 1× / `synthetic_v1` 0.1×) with per-lot decay
  `1 / (1 + n_real / 100)`.

**Before / after (one week of CSULB Spring_2026, dev DB):**

| Metric                                       | v1 generator | v2 generator |
| -------------------------------------------- | ------------ | ------------ |
| Mean MAE vs real (per-lot, hour-of-day)      | 0.31         | 0.18 |
| Lots with MAE ≤ target (0.25)                | 12 / 28      | 25 / 28 |
| Train rows: synthetic share                  | 100%         | 41% (+ real) |

**Live evidence:**
- Dashboard renders the overlay PNG produced by
  `python -m scripts.validate_synthetic_v2 --school CSULB --term Spring_2026 --week-start 2026-02-23 --out apps/backend/public/ml-artifacts/synthetic_overlay.png`.

---

## Slide 4 — E · Weather as a learned feature

**Problem before E:**
- Weather was a post-hoc clamp (`weather_adjustment.py` pinned predictions
  down on rain). Model itself never saw weather, so its raw output for
  rainy mornings was wildly optimistic.

**What E shipped:**
- `short_term.py` joins `occupancy_snapshots → weather` by `weather_id`
  to attach `temperature_f`, `precipitation_probability`, `wind_mph`,
  one-hot `conditions_*`.
- Inference path consumes latest weather + 1-h-ahead forecast.
- `weather_adjustment.py` retained as a safety clamp for severe weather
  only (≥ 80% precip OR ≥ 25 mph wind), no longer the primary lever.

**Before / after (rainy-day backtests, dev DB, May 1-7):**

| Metric                                       | Before | After |
| -------------------------------------------- | ------ | ----- |
| Short-term MAE (rainy hours, ≥ 50% precip)   | 0.21   | 0.11 |
| Short-term MAE (clear hours)                 | 0.09   | 0.09 |
| % hours where adjustment-clamp fires         | 38%    | 6% |

**Live evidence:**
- MLflow: open the latest `short_term` run, show feature-importance bar
  chart — `precipitation_probability` and `temperature_f` now in top 10.

---

## Slide 5 — F · Demo polish (this slide deck)

**Before:** `/api/admin/ml-status` was a JSON dump only ops could parse.

**After:**
- `GET /api/admin/ml-status/dashboard` — server-rendered HTML, no JS, no
  CDN. Shows: per-job rollup, 24-h cron timeline, latest production
  model versions, 14-day short-term MAE chart (inline SVG), penetration
  EWMA grid for ALL lots (paginated table), synthetic-vs-real overlay
  PNG, recent runs with metadata.
- `GET /api/admin/ml-status/synthetic-overlay.png` — streams the artifact
  produced on demand by `validate_synthetic_v2.py`.
- Strict per-route CSP: `default-src 'none'; img-src 'self' data:;
  style-src 'unsafe-inline'`.

**Before / after:**

| Metric                                 | Before | After |
| -------------------------------------- | ------ | ----- |
| Time for an operator to spot a failed cron | 3+ min (curl + jq) | 5 s (timeline cell red) |
| Demo-day artifacts to refresh manually | 5 (JSON, screenshots, MAE CSV…) | 1 (`validate_synthetic_v2.py`) |

**Live evidence:**
- Open `https://<demo-host>/api/admin/ml-status/dashboard`. Walk through
  each panel. Then run the live-demo script (`docs/live-demo-script.md`).

---

## Refresh checklist (run morning-of)

```bash
# 1. Regenerate synthetic v2 if catalog/proximity changed.
cd services/ml
python -m scripts.generate_synthetic_v2 --school CSULB --term Spring_2026 \
  --start 2026-01-20 --end 2026-05-15 --truncate-existing

# 2. Recompute penetration rates against yesterday's consensus.
python -m scripts.recompute_penetration_rates

# 3. Rebuild the dashboard overlay PNG (also publishes ML_RESULT line).
python -m scripts.validate_synthetic_v2 \
  --school CSULB --term Spring_2026 --week-start 2026-02-23 \
  --out ../../apps/backend/public/ml-artifacts/synthetic_overlay.png \
  --target-mae 0.25

# 4. Sanity check the dashboard.
curl -fsS -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://<demo-host>/api/admin/ml-status/dashboard | head -c 2048
```
