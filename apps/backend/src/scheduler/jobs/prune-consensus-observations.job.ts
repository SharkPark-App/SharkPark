import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../database/database.module';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'prune-consensus-observations';
const DEFAULT_RETENTION_DAYS = 180;

function parseRetentionDays(): number {
  const raw = process.env.CONSENSUS_OBSERVATION_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `CONSENSUS_OBSERVATION_RETENTION_DAYS must be a number >= 1, got "${raw}"`,
    );
  }
  return parsed;
}

/**
 * Weekly cron: delete `consensus_observations` rows older than
 * `CONSENSUS_OBSERVATION_RETENTION_DAYS` (default 180d).
 *
 * Why 180d: matches `prune-contributor-pings`. ConsensusObservation is the
 * input to the EWMA penetration-rate recompute, which only consumes the
 * trailing ~14 days of `is_ground_truth = true` rows — older rows have no
 * downstream consumer. Without this prune the table grows unbounded
 * (~12k rows/day at 70 lots × 288 5-min windows ≈ 4.4M rows/year), which
 * the audit flagged as inconsistent with the infra README's "90 days
 * dense backfill" claim.
 */
@Injectable()
export class PruneConsensusObservationsJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const retentionDays = parseRetentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await this.prisma.consensusObservation.deleteMany({
        where: { window_start: { lt: cutoff } },
      });
      this.logger.log(
        `[cron:${NAME}] retention=${retentionDays}d ` +
          `deleted=${result.count} cutoff=${cutoff.toISOString()}`,
      );
    });
  }
}
