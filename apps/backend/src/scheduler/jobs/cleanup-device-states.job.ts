import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { OccupancyEventsService } from '../../occupancy-events/occupancy-events.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'cleanup-device-states';
const STALE_AGE_HOURS = 18;

@Injectable()
export class CleanupDeviceStatesJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly occupancyEvents: OccupancyEventsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const result = await this.occupancyEvents.cleanupStaleDeviceStates(
        STALE_AGE_HOURS,
      );
      this.logger.log(
        `[cron:${NAME}] cleaned ${result.cleaned} stale ENTER records (>${STALE_AGE_HOURS}h)`,
      );
    });
  }
}
