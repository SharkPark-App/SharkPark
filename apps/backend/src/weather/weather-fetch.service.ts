/* eslint-disable no-undef -- Node 18+ global fetch */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/database.module';

interface OpenWeatherResponse {
  weather: { main: string; description: string }[];
  main: { temp: number; feels_like: number; humidity: number };
  wind: { speed: number };
  rain?: { '1h'?: number };
  pop?: number;
}

@Injectable()
export class WeatherFetchService {
  private readonly logger = new Logger(WeatherFetchService.name);
  private readonly apiKey: string;
  private readonly lat: number;
  private readonly lon: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('weather.openWeatherApiKey', '');
    this.lat = this.config.get<number>('weather.latitude', 33.7838);
    this.lon = this.config.get<number>('weather.longitude', -118.1134);
  }

  /**
   * Fetch current weather from OpenWeatherMap and persist a row.
   * Invoked by the `cron:weather` script (Fly cron Machine, every 30min);
   * also exported as a regular service method so it can be triggered manually
   * or from tests.
   */
  async fetchWeather(): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn('OPENWEATHER_API_KEY not set — skipping weather fetch');
      return;
    }

    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${this.lat}&lon=${this.lon}&units=imperial&appid=${this.apiKey}`;
      const response = await fetch(url);

      if (!response.ok) {
        this.logger.error(`OpenWeatherMap returned ${response.status}`);
        return;
      }

      const data = (await response.json()) as OpenWeatherResponse;

      const school = await this.prisma.school.findFirst();
      if (!school) {
        this.logger.error('No school record found — cannot store weather');
        return;
      }

      const isRaining =
        data.weather.some((w) => w.main === 'Rain' || w.main === 'Drizzle') ||
        (data.rain?.['1h'] ?? 0) > 0;

      await this.prisma.weather.create({
        data: {
          school_id: school.id,
          timestamp: new Date(),
          temperature_f: data.main.temp,
          feels_like_f: data.main.feels_like,
          humidity_percent: data.main.humidity,
          wind_speed_mph: data.wind.speed,
          conditions: data.weather[0]?.description ?? 'unknown',
          precipitation_probability: data.pop ?? 0,
          is_raining: isRaining,
        },
      });

      this.logger.log(
        `Weather updated: ${data.main.temp}°F, ${data.weather[0]?.description}`,
      );
    } catch (error) {
      this.logger.error('Failed to fetch weather from OpenWeatherMap', error);
    }
  }
}
