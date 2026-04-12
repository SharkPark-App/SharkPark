import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { WeatherService } from './weather.service';

/**
 * Provides current weather data for parking demand correlation.
 * Weather affects parking patterns (rain = higher demand for covered lots).
 */
@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get('current')
  @HttpCode(HttpStatus.OK)
  async getCurrentWeather() {
    const weather = await this.weatherService.getCurrent();
    return {
      success: true,
      data: weather,
    };
  }

  @Get('impact')
  @HttpCode(HttpStatus.OK)
  async getWeatherImpact() {
    const impact = await this.weatherService.getWeatherImpact();
    return {
      success: true,
      data: impact,
    };
  }
}
