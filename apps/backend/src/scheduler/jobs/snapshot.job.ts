import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { OccupancyEventsService } from '../../occupancy-events/occupancy-events.service';
import { ConsensusService } from '../../reliability/consensus.service';
import { Logger as PinoLogger } from 'nestjs-pino';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'snapshot';

@Injectable()
export class SnapshotJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly occupancyEvents: OccupancyEventsService,
    private readonly consensus: ConsensusService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const result = await this.occupancyEvents.createSnapshots();
      this.logger.log(
        `[cron:${NAME}] created ${result.count} occupancy snapshots at ${result.timestamp}`,
      );

      // Consensus is best-effort: a failure here must NOT block the snapshot
      // tick (snapshots are the primary cron deliverable; consensus is
      // derived analytics). Errors per-lot are already swallowed inside
      // ConsensusService; this try/catch is defense-in-depth for top-level
      // failures (e.g., the Lot.findMany blew up).
      try {
        const consensus = await this.consensus.processLiveTick(new Date());
        this.logger.log(
          `[cron:${NAME}] consensus written=${consensus.written} skipped=${consensus.skipped}`,
        );
      } catch (err) {
        this.logger.warn(
          `[cron:${NAME}] consensus tick failed: ${(err as Error).message}`,
        );
      }
    });
  }
}
