import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';
import { WeatherFetchService } from './weather-fetch.service';
import { WeatherForecastFetchService } from './weather-forecast-fetch.service';
import { NwsClient } from './nws.client';

@Module({
  controllers: [WeatherController],
  providers: [
    WeatherService,
    WeatherFetchService,
    WeatherForecastFetchService,
    NwsClient,
  ],
  exports: [WeatherService],
})
export class WeatherModule {}
