import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { ContributorService } from '../../auth/contributor.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'prune-contributor-pings';
const DEFAULT_IDLE_DAYS = 180;

function parseIdleDays(): number {
  const raw = process.env.CONTRIBUTOR_PING_RETENTION_DAYS;
  if (!raw) return DEFAULT_IDLE_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `CONTRIBUTOR_PING_RETENTION_DAYS must be a number >= 1, got "${raw}"`,
    );
  }
  return parsed;
}

/**
 * Weekly cron: delete `contributor_pings` rows that haven't been seen in
 * `CONTRIBUTOR_PING_RETENTION_DAYS` (default 180) AND whose grant (if any)
 * is also older than that. 180d covers a full college summer recess so
 * returning students are not pruned and forced to re-onboard.
 */
@Injectable()
export class PruneContributorPingsJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly contributor: ContributorService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const idleDays = parseIdleDays();
      const result = await this.contributor.pruneIdlePings(idleDays);
      this.logger.log(
        `[cron:${NAME}] idle=${idleDays}d ` +
          `pings=${result.pings_deleted} cutoff=${result.cutoff}`,
      );
    });
  }
}
