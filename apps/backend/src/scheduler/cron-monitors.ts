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
} as const satisfies Record<string, CronMonitorConfig>;

export type CronJobName = keyof typeof CRON_MONITORS;
