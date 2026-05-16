/**
 * Sentry Crons monitor configuration for each scheduled cron job.
 *
 * Each entry's `schedule` is the source of truth — it's BOTH:
 *   1. The crontab expression passed to `@Cron(...)` on the job class, and
 *   2. The schedule reported to Sentry on every check-in (so Sentry's
 *      "missed" / "timed-out" alerts reflect what's actually scheduled).
 *
 * The lockstep is enforced at boot: SchedulerModule asserts every job
 * decorated with `@Cron(...)` has a matching entry here. There is no
 * separate crontab file — the @Cron decorator IS the schedule.
 *
 *   - `schedule`     standard 5-field crontab string (PT, matches container TZ)
 *   - `checkinMargin` minutes Sentry waits past the scheduled time before
 *                    raising "missed check-in"
 *   - `maxRuntime`   minutes Sentry waits for `ok`/`error` before raising
 *                    "check-in timed out"
 */

export interface CronMonitorConfig {
  schedule: string;
  checkinMargin: number;
  maxRuntime: number;
  /**
   * If true, CronRunnerService writes a row to `ml_cron_runs` for every tick:
   *   - INSERT (status=RUNNING) at start
   *   - UPDATE (status=SUCCESS/FAILED/SKIPPED + duration + metadata) at end
   *
   * Used by the /admin/ml-status endpoint as a Sentry-independent audit
   * trail for ML predictions. Off by default — only the ML cron jobs
   * (predict-short-term, predict-long-term) opt in. Snapshot/weather/etc.
   * already have their own per-domain audit tables.
   */
  track?: boolean;
}

export const CRON_TIMEZONE = 'America/Los_Angeles';

export const CRON_MONITORS = {
  snapshot: {
    schedule: '*/15 * * * *',
    checkinMargin: 5,
    maxRuntime: 10,
  },
  'fetch-weather': {
    schedule: '*/30 * * * *',
    checkinMargin: 10,
    maxRuntime: 15,
  },
  'fetch-weather-forecast': {
    schedule: '0 */6 * * *',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  'fetch-transit': {
    schedule: '0 6 * * *',
    checkinMargin: 30,
    // ~3 sequential PassioGO! HTTP fetches; 10 min is generous headroom
    // while still letting Sentry catch a hung job.
    maxRuntime: 10,
  },
  'cleanup-device-states': {
    schedule: '0 3 * * *',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  'backup-db': {
    schedule: '0 2 * * *',
    checkinMargin: 30,
    maxRuntime: 60,
  },
  'verify-latest-backup': {
    schedule: '0 4 * * 1',
    checkinMargin: 60,
    maxRuntime: 60,
  },
  'prune-old-data': {
    schedule: '0 4 * * 0,2-6',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  'prune-old-events': {
    schedule: '30 4 * * 1',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  'fetch-events': {
    schedule: '0 5 * * *',
    checkinMargin: 10,
    maxRuntime: 15,
  },
  'fetch-sports-events': {
    schedule: '30 5 * * *',
    checkinMargin: 10,
    maxRuntime: 15,
  },
  'refresh-sports-finals': {
    // Every 30 min — short-circuits without an external fetch when no
    // SCHEDULED games sit inside the recent lookback window. Only flips
    // SCHEDULED → FINAL once Sidearm publishes the box score; there is no
    // LIVE state for sports events because the calendar API has no
    // in-progress signal.
    schedule: '*/30 * * * *',
    checkinMargin: 10,
    maxRuntime: 5,
  },
  'notify-favorites-filling': {
    schedule: '*/15 * * * *',
    checkinMargin: 5,
    maxRuntime: 10,
  },
  'notify-favorites-clearing': {
    schedule: '*/15 * * * *',
    checkinMargin: 5,
    maxRuntime: 10,
  },
  'notify-surge': {
    schedule: '*/15 * * * *',
    checkinMargin: 5,
    maxRuntime: 10,
  },
  'notify-events': {
    schedule: '*/15 * * * *',
    checkinMargin: 5,
    maxRuntime: 10,
  },
  'refresh-lot-advisories': {
    schedule: '0 6 * * 0',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  'refresh-lot-metadata': {
    schedule: '0 7 1 * *',
    checkinMargin: 60,
    maxRuntime: 30,
  },
  'prune-notification-logs': {
    schedule: '15 4 * * *',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  'prune-contributor-pings': {
    schedule: '30 5 * * 1',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  'prune-old-report-messages': {
    schedule: '45 4 * * 0',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  // ML inference — short-term predictions for the next ~14 hours, written
  // to the `predictions_short_term` table by services/ml/scripts/
  // predict_short_term.py. Offset 5 minutes after `snapshot` (which runs
  // at */15) so the freshest occupancy data is available as input.
  'predict-short-term': {
    schedule: '5,20,35,50 * * * *',
    checkinMargin: 5,
    maxRuntime: 12,
    track: true,
  },
  // ML inference — 7-day hourly long-term predictions, written to
  // `predictions_long_term`. Runs at 1:05 AM PT so a full day's
  // forecast is on disk before operating hours start.
  'predict-long-term': {
    schedule: '5 1 * * *',
    checkinMargin: 30,
    maxRuntime: 30,
    track: true,
  },
  // ML maintenance — recompute per-(lot, dow_bucket, hour) EWMA penetration-
  // rate estimates from yesterday's ground-truth consensus windows, writing to
  // `penetration_rate_estimates`. Runs at 02:30 PT, after the daily backup
  // (02:00) so the input table is hot in cache, and before predict-long-term
  // (01:05 the *next* day) — order doesn't matter because predictions don't
  // read this table directly; it feeds PenetrationEstimationService at
  // request time once `PENETRATION_RATE_LEARNING_ENABLED` flips on.
  'recompute-penetration-rates': {
    schedule: '30 2 * * *',
    checkinMargin: 30,
    maxRuntime: 20,
    track: true,
  },
  // ML data source — weekly scrape of the public CSULB Schedule of
  // Classes (https://web.csulb.edu/depts/enrollment/registration/...)
  // into `course_meetings`. Powers the synthetic-v2 occupancy generator
  // by giving the trainer real per-section enrollment + meeting blocks
  // (building, room, day, time) instead of v1's uniform-noise priors.
  // Sundays at 03:00 PT — chosen because (a) registrar updates settle
  // on Friday/Saturday, (b) traffic to web.csulb.edu is minimal at
  // that hour, and (c) it precedes the Monday-morning predict-long-term
  // run so a fresh week of synthetic features is available for re-train.
  'ingest-csulb-catalog': {
    schedule: '0 3 * * 0',
    checkinMargin: 60,
    maxRuntime: 35,
    track: true,
  },
  // ML reference data — weekly scrape of the CSULB Academic Scheduling
  // page + per-term lecture-room-allocations page into `room_capacities`
  // and `Building.alternate_names`. Provides the per-(building, room)
  // seat counts the catalog ingest uses for tier-2 enrollment fallback.
  // Saturday 02:00 PT — runs BEFORE the Sunday 03:00 PT catalog ingest
  // so the catalog parser sees fresh capacities / building aliases on
  // its very next run. Sub-30s wall-clock (5 small HTTP fetches), but
  // 25-min cap leaves room for transient slowness without flapping.
  'ingest-room-capacities': {
    schedule: '0 2 * * 6',
    checkinMargin: 60,
    maxRuntime: 25,
    track: true,
  },
  // ML reference data — weekly recompute of the (lot × building)
  // proximity matrix used by the D4 synthetic generator's softmax
  // walk-distance term. Saturday 02:30 PT — 30 min after
  // ingest-room-capacities, in the unlikely case that scrape adds
  // brand-new buildings (rare but cheap to handle). Pure haversine,
  // dwarfed by DB upsert; sub-5s wall-clock at CSULB scale (~150
  // buildings × ~70 lots = 10k pairs evaluated, < 1k retained). 10-min
  // cap leaves ample headroom.
  'build-proximity-matrix': {
    schedule: '30 2 * * 6',
    checkinMargin: 30,
    maxRuntime: 10,
    track: true,
  },
  // Weekly retention prune for the consensus_observations table. Default
  // 180d via CONSENSUS_OBSERVATION_RETENTION_DAYS — matches the
  // contributor-pings retention. EWMA penetration recompute only consumes
  // the trailing ~14 days, so the rest is dead weight. Mondays 06:00 PT
  // (after prune-old-events at 30 4 and prune-contributor-pings at 30 5).
  'prune-consensus-observations': {
    schedule: '0 6 * * 1',
    checkinMargin: 30,
    maxRuntime: 30,
  },
  // Daily ML drift / prediction-vs-actual feedback. Joins yesterday's
  // predictions_short_term against the matching occupancy_snapshots
  // (within ±8 min of target_time) and emits per-lot MAE / RMSE / coverage
  // / 80%-interval hit rate to Sentry as a structured info message. 05:15
  // PT — late enough that the previous day's last 23:45 snapshot is
  // durably written; early enough to alert before the morning peak.
  'prediction-accuracy': {
    schedule: '15 5 * * *',
    checkinMargin: 30,
    maxRuntime: 10,
    track: true,
  },
  // CSULB freezes parking fees per fiscal year (Sep 1 → Aug 31). Mondays
  // at 09:00 PT during July and August this fetches the permit-information
  // page, normalises + SHA-256s the body, and fires a Sentry warning when
  // the hash diverges from EXPECTED_PERMIT_SOURCE_HASH_SHA256 in
  // `apps/backend/src/lots/permit-fees.ts`. Engineer then reviews the page,
  // updates the constants + hash, and ships a PR. Runs outside the July-Aug
  // window are a no-op (cron expression filters by month).
  'check-permit-fee-drift': {
    schedule: '0 9 * 7-8 1',
    checkinMargin: 30,
    maxRuntime: 5,
  },
} as const satisfies Record<string, CronMonitorConfig>;

export type CronJobName = keyof typeof CRON_MONITORS;
