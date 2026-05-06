import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { WeatherForecastFetchService } from '../../weather/weather-forecast-fetch.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'fetch-weather-forecast';

@Injectable()
export class FetchWeatherForecastJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly forecast: WeatherForecastFetchService,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, () => this.forecast.fetchForecast());
  }
}
