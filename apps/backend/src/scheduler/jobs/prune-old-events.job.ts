import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { EventsService } from '../../events/events.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'prune-old-events';
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

/**
 * Weekly cron: delete past `campus_events` rows. Override with
 * `EVENT_RETENTION_DAYS` (default 90).
 */
@Injectable()
export class PruneOldEventsJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly events: EventsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const retentionDays = parseRetentionDays();
      const result = await this.events.pruneOldEvents(retentionDays);
      this.logger.log(
        `[cron:${NAME}] retention=${retentionDays}d ` +
          `events=${result.events_deleted} cutoff=${result.cutoff.toISOString()}`,
      );
    });
  }
}
