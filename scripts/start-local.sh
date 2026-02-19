#!/usr/bin/env bash
set -e

# ── 1. Start Docker containers ──────────────────────────────────────
docker compose -f docker/docker-compose.yml up -d
echo "[OK] Local infra up (PostgreSQL + LocalStack)"

# ── 2. Wait for PostgreSQL to accept connections ────────────────────
echo "[..] Waiting for PostgreSQL..."
retries=0
max_retries=30
until docker exec sharkpark-postgres pg_isready -U sharkpark -q 2>/dev/null; do
  retries=$((retries + 1))
  if [ "$retries" -ge "$max_retries" ]; then
    echo "[FAIL] PostgreSQL did not become ready in time"
    exit 1
  fi
  sleep 1
done
echo "[OK] PostgreSQL is ready"

# ── 3. Run Prisma migrations (idempotent — safe to re-run) ─────────
echo "[..] Running database migrations..."
pnpm --filter @sharkpark/backend exec prisma migrate deploy 2>&1
echo "[OK] Migrations applied"

# ── 4. Generate Prisma client (needed after fresh install) ──────────
pnpm --filter @sharkpark/backend exec prisma generate 2>/dev/null || true

# ── 5. Seed the database (only if tables are empty) ─────────────────
EXISTING_LOTS=$(docker exec sharkpark-postgres psql -U sharkpark -d sharkpark -tAc "SELECT count(*) FROM lots;" 2>/dev/null | tr -d '[:space:]')
if [ "$EXISTING_LOTS" = "0" ] || [ -z "$EXISTING_LOTS" ]; then
  echo "[..] Seeding database..."
  pnpm --filter @sharkpark/backend exec prisma db seed 2>/dev/null || true
  echo "[OK] Database seeded"
else
  echo "[SKIP] Database already has $EXISTING_LOTS lots -- skipping seed"
fi
