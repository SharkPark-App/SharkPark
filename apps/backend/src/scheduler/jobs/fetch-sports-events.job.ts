import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { SportsEventsScraperService } from '../../events/sports-events-scraper.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'fetch-sports-events';

@Injectable()
export class FetchSportsEventsJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly scraper: SportsEventsScraperService,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, () => this.scraper.scrapeAll());
  }
}
