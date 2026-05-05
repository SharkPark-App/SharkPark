import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/database.module';
import {
  NwsClient,
  computeFeelsLikeF,
  deriveIsRaining,
  parseWindSpeedMph,
  probabilityToRate,
} from './nws.client';

/**
 * Persists the current weather observation by reading the *current hour*
 * slice (`periods[0]`) of the NWS hourly forecast for the school's gridpoint.
 *
 * Why the forecast's current-hour period instead of `/stations/.../observations/latest`?
 *  - The forecast endpoint returns `probabilityOfPrecipitation`. Station obs
 *    don't carry pop, and the ML weather adjustment in
 *    `services/ml/src/postprocess/weather_adjustment.py` uses that field.
 *  - One endpoint = one failure domain, one cache key, one mock in tests,
 *    one set of NWS rate-limit considerations.
 *  - The `fetch-weather-forecast` cron uses the same endpoint, so the data
 *    shapes are identical — fewer adapters to maintain.
 *
 * Cron: every 30 min (see `apps/backend/src/scheduler/cron-monitors.ts`).
 */
@Injectable()
export class WeatherFetchService {
  private readonly logger = new Logger(WeatherFetchService.name);
  private readonly lat: number;
  private readonly lon: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly nws: NwsClient,
  ) {
    this.lat = this.config.get<number>('weather.latitude', 33.7838);
    this.lon = this.config.get<number>('weather.longitude', -118.1134);
  }

  async fetchWeather(): Promise<void> {
    try {
      const { periods } = await this.nws.getHourlyForecast(this.lat, this.lon);
      const current = periods[0];
      if (!current) {
        this.logger.error('NWS hourly forecast returned no periods');
        return;
      }

      const school = await this.prisma.school.findFirst();
      if (!school) {
        this.logger.error('No school record found — cannot store weather');
        return;
      }

      // NWS returns Fahrenheit for US grids. Convert defensively if not.
      const tempF =
        current.temperatureUnit === 'F'
          ? current.temperature
          : (current.temperature * 9) / 5 + 32;

      const windMph = parseWindSpeedMph(current.windSpeed);
      const humidity = current.relativeHumidity?.value ?? 0;
      const conditions = (current.shortForecast ?? 'unknown').toLowerCase();

      await this.prisma.weather.create({
        data: {
          school_id: school.id,
          timestamp: new Date(),
          temperature_f: tempF,
          feels_like_f: computeFeelsLikeF(tempF, humidity, windMph),
          humidity_percent: humidity,
          wind_speed_mph: windMph,
          conditions,
          precipitation_probability: probabilityToRate(
            current.probabilityOfPrecipitation,
          ),
          is_raining: deriveIsRaining(current),
        },
      });

      this.logger.log(
        `Weather updated: ${tempF}°F, ${conditions}`,
      );
    } catch (error) {
      this.logger.error('Failed to fetch weather from NWS', error);
    }
  }
}
