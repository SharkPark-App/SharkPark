import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { WeatherFetchService } from '../../weather/weather-fetch.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'fetch-weather';

@Injectable()
export class FetchWeatherJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly weather: WeatherFetchService,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, () => this.weather.fetchWeather());
  }
}
