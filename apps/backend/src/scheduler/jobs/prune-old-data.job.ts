import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { OccupancyEventsService } from '../../occupancy-events/occupancy-events.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'prune-old-data';
const DEFAULT_RETENTION_DAYS = 30;

function parseRetentionDays(): number {
  const raw = process.env.RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`RETENTION_DAYS must be a number >= 1, got "${raw}"`);
  }
  return parsed;
}

/**
 * Raw-data retention cron — honors the privacy promise in README.md
 * ("raw events purged after 30 days"). Deletes from `occupancy_events` only.
 * Override the window with `RETENTION_DAYS`.
 */
@Injectable()
export class PruneOldDataJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly occupancyEvents: OccupancyEventsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const retentionDays = parseRetentionDays();
      const result = await this.occupancyEvents.pruneOldData(retentionDays);
      this.logger.log(
        `[cron:${NAME}] retention=${retentionDays}d events=${result.events_deleted} cutoff=${result.cutoff}`,
      );
    });
  }
}
