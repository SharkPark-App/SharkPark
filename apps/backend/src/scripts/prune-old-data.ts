import { runCronJob } from './_bootstrap';
import { OccupancyEventsService } from '../occupancy-events/occupancy-events.service';

/**
 * Raw-event data retention cron.
 *
 * Deletes rows from `occupancy_events` older than 30 days, honoring the
 * user-facing privacy promise in README.md. `occupancy_snapshots` and
 * all aggregated tables are kept permanently (see infrastructure/README.md
 * "Data Retention") — this script never touches them.
 *
 * Override the window with the `RETENTION_DAYS` env var (defaults to 30).
 * Runs daily at 4 AM Pacific, after the 2 AM backup, so the deleted rows
 * are present in the most recent dump.
 */
const DEFAULT_RETENTION_DAYS = 30;

function parseRetentionDays(): number {
  const raw = process.env.RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `RETENTION_DAYS must be a number >= 1, got "${raw}"`,
    );
  }
  return parsed;
}

void runCronJob('prune-old-data', async ({ app, logger }) => {
  const retentionDays = parseRetentionDays();
  const svc = app.get(OccupancyEventsService);
  const result = await svc.pruneOldData(retentionDays);
  logger.log(
    `[cron:prune-old-data] retention=${retentionDays}d events=${result.events_deleted} cutoff=${result.cutoff}`,
  );
});
