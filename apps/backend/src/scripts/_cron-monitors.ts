/**
 * Sentry Crons monitor configuration for each scheduled cron job.
 *
 * Each entry MUST mirror the schedule in `apps/backend/cron/crontab`. When
 * `runCronJob` fires the `in_progress` check-in it includes this config so
 * Sentry will auto-create / update the monitor on first contact — no manual
 * monitor setup in the Sentry UI required.
 *
 * - `schedule`     standard 5-field crontab string (PT, matches container TZ)
 * - `checkinMargin` minutes Sentry waits past the scheduled time before
 *                   raising "missed check-in"
 * - `maxRuntime`   minutes Sentry waits for `ok`/`error` before raising
 *                  "check-in timed out"
 *
 * If a job here is not present in `crontab`, or vice versa, that's a bug —
 * keep them in lockstep. Adding a new cron: add the script, add the crontab
 * line, add an entry here.
 */

export interface CronMonitorConfig {
  schedule: string;
  checkinMargin: number;
  maxRuntime: number;
}

const TIMEZONE = 'America/Los_Angeles';

export const CRON_MONITORS: Record<string, CronMonitorConfig> = {
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
    schedule: '0 0 * * *',
    checkinMargin: 30,
    maxRuntime: 30,
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
  'fetch-events': {
    schedule: '0 5 * * *',
    checkinMargin: 10,
    maxRuntime: 15,
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
};

export const CRON_TIMEZONE = TIMEZONE;
