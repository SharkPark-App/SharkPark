import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ShuttleTrackerService } from '../../shuttle-tracker/shuttle-tracker.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'fetch-transit';

@Injectable()
export class FetchTransitJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly shuttle: ShuttleTrackerService,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      await this.shuttle.fetchRoutesAndStops();
      await this.shuttle.fetchShuttles();
    });
  }
}
