#!/usr/bin/env bash
# scripts/measure-cold-start.sh
#
# Formal cold-start latency measurement (P5.61).
#
# Usage:
#   ./scripts/measure-cold-start.sh                       # default: 10 min wait, prod
#   ./scripts/measure-cold-start.sh --idle-min 15         # custom idle wait
#   ./scripts/measure-cold-start.sh --url https://...     # custom endpoint
#   ./scripts/measure-cold-start.sh --skip-wait           # measure now (assume already cold)
#
# Methodology:
#   1. Wait for the configured idle period so the Fly machine autostops
#      (fly.toml: auto_stop_machines='stop', min_machines_running=0).
#   2. Hit the readiness endpoint once — this is the cold-start cost.
#   3. Hit it 5 more times in quick succession — warm steady-state p50/p95.
#
# Output: cURL timing breakdown (DNS / TCP / TLS / TTFB / TOTAL) for each
# request. The first request's TOTAL is the cold-start latency.
#
# Recorded in docs/runbooks/runbook.md → "RTO/RPO Targets" → cold-start row.

set -euo pipefail

URL="${URL:-https://api.sharkpark.app/api/v1/health/ready}"
IDLE_MIN=10
SKIP_WAIT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --idle-min) IDLE_MIN="$2"; shift 2 ;;
    --url)      URL="$2"; shift 2 ;;
    --skip-wait) SKIP_WAIT=1; shift ;;
    -h|--help)
      sed -n '1,/^set -euo/p' "$0" | sed 's/^# \?//' | head -n -2
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ "$SKIP_WAIT" -eq 0 ]; then
  echo "Waiting ${IDLE_MIN} minutes for Fly machine to autostop..."
  echo "(autostop kicks in after the soft-stop threshold; ~5 min on stop_machines='stop')"
  sleep $((IDLE_MIN * 60))
fi

echo "=== Cold-start measurement: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "URL: $URL"
echo

FMT='  DNS:%{time_namelookup}s  TCP:%{time_connect}s  TLS:%{time_appconnect}s  TTFB:%{time_starttransfer}s  TOTAL:%{time_total}s  CODE:%{http_code}\n'

echo "Request 1 (COLD):"
curl -sS -o /dev/null -w "$FMT" "$URL"
echo

echo "Requests 2-6 (warm):"
for i in 2 3 4 5 6; do
  printf "  #%d:" "$i"
  curl -sS -o /dev/null -w "$FMT" "$URL"
done

echo
echo "Done. Record the cold TOTAL and warm p50/p95 in the runbook."
