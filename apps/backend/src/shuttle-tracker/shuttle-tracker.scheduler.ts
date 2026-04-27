import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ShuttleTrackerService } from './shuttle-tracker.service';

@Injectable()
export class ShuttleTrackerScheduler {
  constructor(
    private readonly shuttleTrackerService: ShuttleTrackerService
  ) {}

  // Update shuttle locations every minute (maximum frequency is 10 seconds)
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleShuttleCron() {
    await this.shuttleTrackerService.fetchShuttles();
  }

  // Update routes and stops once a day
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRoutesAndStopsCron() {
    await this.shuttleTrackerService.fetchRoutesAndStops();
  }
}