import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';
import { WeatherFetchService } from './weather-fetch.service';

@Module({
  controllers: [WeatherController],
  providers: [WeatherService, WeatherFetchService],
  exports: [WeatherService],
})
export class WeatherModule {}
