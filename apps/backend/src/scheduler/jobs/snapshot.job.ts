import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { OccupancyEventsService } from '../../occupancy-events/occupancy-events.service';
import { Logger as PinoLogger } from 'nestjs-pino';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'snapshot';

@Injectable()
export class SnapshotJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly occupancyEvents: OccupancyEventsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const result = await this.occupancyEvents.createSnapshots();
      this.logger.log(
        `[cron:${NAME}] created ${result.count} occupancy snapshots at ${result.timestamp}`,
      );
    });
  }
}
