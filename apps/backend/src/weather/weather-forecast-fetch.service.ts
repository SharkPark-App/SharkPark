import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/database.module';
import {
  NwsClient,
  deriveIsRaining,
  parseWindSpeedMph,
  probabilityToRate,
} from './nws.client';

/**
 * Fetches the full ~156-hour NWS hourly forecast and upserts every period
 * into `weather_forecasts`, keyed by (school, target_time). New cron runs
 * overwrite stale forecasts for the same hour with whatever the latest NWS
 * model says — no historical forecast accuracy logging here, that's a
 * separate post-launch tracking item (see TODO.md long-term-MAE bullet).
 *
 * Cron: every 6 hours (forecasts re-issue ~hourly upstream but the value
 * delta is small, and 6h keeps NWS request volume tiny).
 */
@Injectable()
export class WeatherForecastFetchService {
  private readonly logger = new Logger(WeatherForecastFetchService.name);
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

  async fetchForecast(): Promise<void> {
    try {
      const { periods } = await this.nws.getHourlyForecast(this.lat, this.lon);
      if (periods.length === 0) {
        this.logger.error('NWS hourly forecast returned no periods');
        return;
      }

      const school = await this.prisma.school.findFirst();
      if (!school) {
        this.logger.error('No school record found — cannot store forecast');
        return;
      }

      const now = new Date();
      let upserts = 0;

      // Drop past forecasts opportunistically. Stale rows aren't useful and
      // we never look back at them — the long-term forecast accuracy
      // tracking lives in a separate table (see TODO.md "MAE tracking").
      await this.prisma.weatherForecast.deleteMany({
        where: { school_id: school.id, target_time: { lt: now } },
      });

      // Upsert per-period rather than deleteMany+createMany so concurrent
      // queries reading the table never see an empty result set.
      for (const p of periods) {
        const tempF =
          p.temperatureUnit === 'F'
            ? p.temperature
            : (p.temperature * 9) / 5 + 32;
        const windMph = parseWindSpeedMph(p.windSpeed);
        const targetTime = new Date(p.startTime);
        const conditions = (p.shortForecast ?? 'unknown').toLowerCase();

        const data = {
          temperature_f: tempF,
          precipitation_probability: probabilityToRate(
            p.probabilityOfPrecipitation,
          ),
          is_raining: deriveIsRaining(p),
          wind_speed_mph: windMph,
          conditions,
          fetched_at: now,
        };

        await this.prisma.weatherForecast.upsert({
          where: {
            school_id_target_time: {
              school_id: school.id,
              target_time: targetTime,
            },
          },
          create: {
            school_id: school.id,
            target_time: targetTime,
            ...data,
          },
          update: data,
        });
        upserts++;
      }

      this.logger.log(
        `Weather forecast updated: ${upserts} hourly periods upserted`,
      );
    } catch (error) {
      this.logger.error('Failed to fetch weather forecast from NWS', error);
    }
  }
}
