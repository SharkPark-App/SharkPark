import { runCronJob } from './_bootstrap';
import { EventsModule } from '../events/events.module';
import { EventsService } from '../events/events.service';

/**
 * Weekly cron: delete past `campus_events` rows.
 *
 * The API (`getEventsForLot`) only returns events with `end_time >= now`, so
 * past events are dead weight in the table + nightly backup. Override the
 * window with `EVENT_RETENTION_DAYS` (default 90, generous buffer for any
 * post-hoc analysis).
 *
 * Runs Mondays at 4:30 AM Pacific — staggered after `verify-latest-backup`
 * (4:00 AM Mon) so deleted rows are present in the most recent verified dump.
 */
const DEFAULT_EVENT_RETENTION_DAYS = 90;

function parseRetentionDays(): number {
  const raw = process.env.EVENT_RETENTION_DAYS;
  if (!raw) return DEFAULT_EVENT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `EVENT_RETENTION_DAYS must be a number >= 1, got "${raw}"`,
    );
  }
  return parsed;
}

void runCronJob('prune-old-events', [EventsModule], async ({ app, logger }) => {
  const retentionDays = parseRetentionDays();
  const svc = app.get(EventsService);
  const result = await svc.pruneOldEvents(retentionDays);
  logger.log(
    `[cron:prune-old-events] retention=${retentionDays}d ` +
      `events=${result.events_deleted} cutoff=${result.cutoff.toISOString()}`,
  );
});
