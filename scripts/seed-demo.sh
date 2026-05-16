#!/usr/bin/env bash
#
# scripts/seed-demo.sh
#
# One-shot: populate a clean local SharkPark database with EVERYTHING needed
# for the senior-project demo video — static lots/users/buildings, plus
# real-world dynamic data:
#
#   1. prisma db seed              — schools, lots, buildings, users,
#                                    favorites, sample events, weather,
#                                    7d snapshots, occupancy events
#   2. seed-demo-bootstrap         — current weather (NWS), 156h forecast
#                                    (NWS), upcoming campus events
#                                    (CampusLabs)
#   3. build_proximity_matrix      — lot×building distance matrix
#   4. predict_short_term          — next ~14h short-term predictions
#   5. predict_long_term           — next 7d long-term predictions
#
# After this completes, every screen in the mobile app has real data and
# Prisma Studio shows populated rows in every table the app reads.
#
# Requires:
#   - Local Postgres reachable at the DATABASE_URL in apps/backend/.env
#     (default: postgres://sharkpark:sharkpark@localhost:5433/sharkpark)
#   - Python ML deps installed (uv sync in services/ml)
#   - Trained models registered locally in services/ml/mlruns/
#     (look for mlruns/models/short-term-production and
#     mlruns/models/long-term-production)
#
# Usage:
#   scripts/seed-demo.sh                # full reset + seed + bootstrap + ML
#   SKIP_RESET=1 scripts/seed-demo.sh   # skip prisma migrate reset
#   SKIP_ML=1 scripts/seed-demo.sh      # skip Python ML scripts
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/apps/backend"
ML_DIR="$REPO_ROOT/services/ml"

# Force every step to use the local DB regardless of which DATABASE_URL the
# Python services/ml/.env is currently pointing at — we never want demo
# seeding to write to prod by accident.
LOCAL_DB_URL="${LOCAL_DATABASE_URL:-postgresql://sharkpark:sharkpark@localhost:5433/sharkpark?schema=public}"

# psycopg2 (used by services/ml) doesn't recognize Prisma's `?schema=` param
# and hard-errors on it. Strip it for the Python steps.
LOCAL_DB_URL_PG="${LOCAL_DB_URL//\?schema=public/}"
LOCAL_DB_URL_PG="${LOCAL_DB_URL_PG//&schema=public/}"

# Hard guardrail: refuse to run if LOCAL_DB_URL doesn't look local. This is
# the last line of defense in case someone exports a prod LOCAL_DATABASE_URL
# by mistake. The Node bootstrap has its own check; this catches the prisma
# migrate reset --force step which runs before any Node guard executes.
if ! [[ "$LOCAL_DB_URL" =~ (localhost|127\.0\.0\.1|host\.docker\.internal|::1) ]]; then
  echo "[seed-demo] FATAL: LOCAL_DB_URL is not local: ${LOCAL_DB_URL//:*@/:***@}" >&2
  echo "[seed-demo] Refusing to run — 'prisma migrate reset --force' would wipe a remote DB." >&2
  exit 1
fi
for pattern in 'neon\.tech' 'fly\.dev' 'supabase\.' 'amazonaws\.com' 'azure\.com'; do
  if [[ "$LOCAL_DB_URL" =~ $pattern ]]; then
    echo "[seed-demo] FATAL: LOCAL_DB_URL matches production host pattern: $pattern" >&2
    exit 1
  fi
done

# Export so every child process (prisma, ts-node bootstrap, uv) sees the
# isolated local URL instead of whatever DATABASE_URL the parent shell or
# apps/backend/.env happens to set.
export DATABASE_URL="$LOCAL_DB_URL"

step() {
  echo
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════════════════════════"
}

# ────────────────────────────────────────────────────────────
# 1. Reset + base seed
# ────────────────────────────────────────────────────────────
if [[ "${SKIP_RESET:-0}" == "1" ]]; then
  step "1/5 — base seed (skipping migrate reset)"
  cd "$BACKEND_DIR"
  pnpm db:seed
else
  step "1/5 — prisma migrate reset + base seed"
  cd "$BACKEND_DIR"
  # `migrate reset --force` wipes the DB, re-applies migrations, then runs
  # the seed declared in package.json's prisma.seed key.
  pnpm prisma migrate reset --force --skip-generate
fi

# ────────────────────────────────────────────────────────────
# 2. Bootstrap dynamic data via Nest services (weather, forecast, events)
# ────────────────────────────────────────────────────────────
step "2/5 — fetch current weather + 156h forecast + upcoming events"
cd "$BACKEND_DIR"
pnpm exec ts-node \
  --project tsconfig.scripts.json \
  --compiler-options '{"module":"CommonJS"}' \
  src/scripts/seed-demo-bootstrap.ts

# ────────────────────────────────────────────────────────────
# 3-5. ML scripts — write to local DB
# ────────────────────────────────────────────────────────────
if [[ "${SKIP_ML:-0}" == "1" ]]; then
  echo
  echo "[seed-demo] SKIP_ML=1 — skipping ML scripts."
  echo "[seed-demo] To populate predictions later:"
  echo "[seed-demo]   cd services/ml && DATABASE_URL='$LOCAL_DB_URL' uv run python -m scripts.predict_short_term"
  exit 0
fi

if ! command -v uv >/dev/null 2>&1; then
  echo
  echo "[seed-demo] ERROR: 'uv' not found in PATH — required for ML scripts."
  echo "[seed-demo] Install with:  curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "[seed-demo] Or re-run with SKIP_ML=1 to skip prediction generation."
  exit 1
fi

cd "$ML_DIR"
export DATABASE_URL="$LOCAL_DB_URL_PG"

step "3/5 — generate short-term predictions (full day)"
# `--start-of-day` predicts for every operating hour from OPERATING_START_HOUR
# onwards instead of only future hours, so demo data looks the same regardless
# of what time of day the seed was run.
uv run python -m scripts.predict_short_term --start-of-day

step "4/5 — generate long-term predictions (next 7d)"
uv run python -m scripts.predict_long_term

step "5/5 — build lot×building proximity matrix"
# Run last: prisma db seed wipes this table, so any future re-seed without
# the rest of this script would leave it empty. Doing it last means a
# successful run always ends with proximity populated.
uv run python -m scripts.build_proximity_matrix

echo
echo "═══════════════════════════════════════════════════════════════════"
echo "  ✓ Demo seed complete."
echo "═══════════════════════════════════════════════════════════════════"
echo
echo "Open Prisma Studio to verify:"
echo "  cd apps/backend && pnpm prisma studio"
echo
echo "Tables now populated:"
echo "  schools, lots, buildings, lot_buildings, lot_advisories,"
echo "  users, user_favorites, campus_events, weather, weather_forecasts,"
echo "  occupancy_snapshots, occupancy_events, device_states,"
echo "  lot_building_proximity, predictions_short_term, predictions_long_term,"
echo "  ml_cron_runs"
