# SharkPark — Live demo script

> Walks the audience through the full self-improving loop end-to-end:
> trigger a manual retrain, watch MLflow, observe the auto-promotion
> guard make a decision in real time, refresh the dashboard, see the
> new `model_version` propagate. Total wall-clock target: **8 minutes**.

## 0. Pre-flight (60 s, off-camera)

Open four terminal panes + two browser tabs:

| Pane / tab | What it shows                                                     |
| ---------- | ----------------------------------------------------------------- |
| Pane A     | `cd services/ml && source .venv/bin/activate`                     |
| Pane B     | `cd apps/backend`                                                 |
| Pane C     | `mlflow ui --backend-store-uri $MLFLOW_TRACKING_URI` (port 5000)  |
| Pane D     | `tail -f apps/backend/logs/cron.log` (or `fly logs -a sharkpark-backend`) |
| Tab 1      | `https://<demo-host>/api/admin/ml-status/dashboard` (with `?windowHours=24`) |
| Tab 2      | `http://localhost:5000` (MLflow UI)                               |

Verify before going live:
```bash
# In pane B
echo $ADMIN_API_KEY | head -c 8           # should print first 8 chars
curl -fsS -H "x-admin-api-key: $ADMIN_API_KEY" \
  https://<demo-host>/api/admin/ml-status | jq '.jobs | length'
# Expect ≥ 4 (predict-short-term, predict-long-term, recompute-penetration-rates, snapshot)
```

If the dashboard's overlay PNG is stale or missing, run the morning-of
refresh from `docs/demo-slides.md` first.

---

## Step 1 — Establish the baseline (60 s)

**Tab 1 → dashboard**:
- Top: per-job rollup. Highlight the **Latest production model versions**
  panel — note the current `short_term` and `long_term` model versions.
  Read the timestamps aloud.
- Mid: 14-day **Short-term MAE chart**. Point at the most recent dot;
  call out the value (e.g. "0.084 — better than rule by ~40%").
- Bot: **EWMA grid** — scroll to lot G1 to show `blendableBuckets > 0`
  and `lastUpdatedAt < 24h`.

**Talking point:** "Everything you're about to see came from one cron
pipeline that runs without human input. We're going to interrupt that
loop, force a retrain, and watch the auto-promotion guard make a
decision live."

---

## Step 2 — Trigger a manual retrain (90 s)

**Pane A:**
```bash
# Train a fresh model on the current real + v2 synthetic mix. Logs each
# epoch's MAE to MLflow. The script PRINTS the new run_id at the end.
python -m scripts.train_short_term \
  --real-weight 10 \
  --synthetic-v2-weight 1 \
  --synthetic-weight 0.1 \
  2>&1 | tee /tmp/train.log
RUN_ID=$(grep -oE 'mlflow_run_id=[a-f0-9]+' /tmp/train.log | tail -1 | cut -d= -f2)
echo "$RUN_ID"
```

**Tab 2 → MLflow UI:** Refresh the `short_term` experiment. Open the
new run. Walk through:
- **Params** tab → show the tier weights and per-lot decay constants.
- **Metrics** tab → `mae`, `mae_real_clean`, `mae_real_cold`,
  `mae_synthetic_v2`. Draw the audience's eye to the per-tier breakdown
  (E: weather feature shows up here too).
- **Artifacts** → click `feature_importance.png` to confirm
  `precipitation_probability` is in the top-10 list.

---

## Step 3 — Run the auto-promotion guard (90 s)

The promote step is gated: it refuses to ship a model whose MAE is ≥ 2×
the trailing long-term average (spec § "Auto-promotion guard").

**Pane A:**
```bash
# This is what cron calls. Same code path, no shortcuts.
python -m scripts.promote_short_term --run-id "$RUN_ID" 2>&1 | tee /tmp/promote.log
```

Read the decision aloud — three possible outputs:
1. `Promoted run=<...> model_version=v<N>` ← happy path.
2. `Refusing to promote: candidate MAE 0.187 ≥ 2× trailing avg 0.084` ←
   guard fired. **This is a feature, not a failure** — explain that the
   trailing average is the system's own learned baseline; we don't ship
   regressions even if a single training run looked OK in isolation.
3. `Refusing to promote: candidate MAE NaN` ← training had no eval set;
   investigate post-demo.

If outcome (2) fires during the demo, that's the headline moment:

> "The system just rejected a model it trained itself. That's the
> guard rail that lets us run this loop unattended."

---

## Step 4 — Refresh the dashboard (30 s)

**Tab 1 → dashboard reload (Cmd-R).**

If outcome (1):
- **Latest production model versions** row for `short_term` jumps to the
  new `v<N>` with `lastSuccessAt = just now`.
- **Recent runs** table shows a fresh row for `predict-short-term` (next
  cron tick) or `train-short-term` (depending on which cron fired
  last). Hover the metadata column to expand the JSON.

If outcome (2):
- The model version row is **unchanged**. The recent-runs table shows
  the `train-short-term` run with `status = SUCCESS` and metadata
  `{"promoted": false, "reason": "guard_fired", ...}`.

Both outcomes are dashboard-visible without anyone touching the DB.

---

## Step 5 — Show the synthetic-vs-real overlay (60 s)

**Tab 1 → scroll to "Synthetic v2 vs real consensus" panel.**

The PNG is the artifact written by `validate_synthetic_v2.py` — point
out the date/time stamp under the image (it's the file's mtime).

**Pane A — regenerate live to prove it's not a screenshot:**
```bash
python -m scripts.validate_synthetic_v2 \
  --school CSULB --term Spring_2026 --week-start 2026-02-23 \
  --out ../../apps/backend/public/ml-artifacts/synthetic_overlay.png \
  --target-mae 0.25
# stdout ends with: ML_RESULT: {"task": "validate_synthetic_v2", ...}
```

Reload the dashboard. The image's `?t=` cache-buster updates and the
mtime caption advances to the current second.

---

## Step 6 — Q&A anchor: penetration-rate drill-down (60 s, optional)

If asked "is this just curve fitting?" — open
`https://<demo-host>/api/admin/penetration-rate/G1`. Show the per-bucket
EWMA, sample_count, and rule comparison. Each cell is one (dow_bucket,
hour_bucket) pair backed by ground-truth contributor consensus from
B-tier — not by the model's own predictions.

---

## Wrap (15 s)

> "Every dashboard panel you saw is the same data the cron pipeline
> uses to make its own decisions. The model trains itself, validates
> itself, and refuses to ship when its own learned baseline says it
> shouldn't. The dashboard is just a window into that loop."

---

## Failure-mode crib sheet

| Symptom on stage                          | Probable cause                                | Recovery |
| ----------------------------------------- | --------------------------------------------- | -------- |
| Dashboard returns 401                     | `ADMIN_API_KEY` env var unset on demo host    | `fly secrets list -a sharkpark-backend` to verify; re-set then `fly deploy`. |
| Dashboard returns 500 on overlay panel    | PNG missing from `apps/backend/public/ml-artifacts/` | Run Step 5 to regenerate; the panel falls back to "Overlay PNG not available". |
| Train script crashes on `boto3` import    | MLflow artifact backend mis-configured        | Set `MLFLOW_S3_ENDPOINT_URL` or fall back to local file backend (`MLFLOW_TRACKING_URI=file:./mlruns`). |
| Promote script prints `MAE NaN`           | Eval split was empty (rare)                   | Re-train with `--eval-fraction 0.2`; do not promote NaN. |
| EWMA grid shows all `blendableBuckets=0`  | `recompute-penetration-rates` cron hasn't run today, or `PENETRATION_RATE_LEARNING_ENABLED=false` | Run `python -m scripts.recompute_penetration_rates` once; flip flag to `true`. |
