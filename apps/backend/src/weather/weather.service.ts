import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { Weather } from '@prisma/client';

/** Describes how weather conditions affect parking demand */
export interface WeatherImpact {
  factor: number;        // Multiplier: >1 = more demand, <1 = less demand
  description: string;   // Human-readable summary
  conditions: string;    // Raw conditions string
  is_raining: boolean;
  temperature_f: number;
}

/**
 * Service for weather data that may influence parking patterns.
 * Rain or extreme heat typically increases parking demand.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves the most recent CSULB campus observation within the last
   * 24 hours. We deliberately do NOT scope by calendar day: a cron miss
   * just after midnight or a backfill that lands at 23:55 should still
   * surface a usable reading to the mobile UI. Anything older than 24h
   * is treated as missing so we don't show stale weather as "current".
   */
  async getCurrent(): Promise<Weather | null> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const weather = await this.prisma.weather.findFirst({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: 'desc' },
      });

      if (!weather) {
        this.logger.warn(
          `No weather observations in the last 24h (since ${since.toISOString()})`,
        );
        return null;
      }

      return weather;
    } catch (error) {
      this.logger.error('Failed to fetch current weather', error);
      throw error;
    }
  }

  /**
   * Computes a weather-based demand impact factor.
   * Rain increases parking demand (people avoid walking), extreme temps also increase demand.
   * Returns null if no weather data is available.
   */
  async getWeatherImpact(): Promise<WeatherImpact | null> {
    const weather = await this.getCurrent();
    if (!weather) return null;

    let factor = 1.0;
    const reasons: string[] = [];

    // Rain significantly increases parking demand
    if (weather.is_raining) {
      factor += 0.15;
      reasons.push('rain increases demand');
    } else if (weather.precipitation_probability > 0.6) {
      factor += 0.08;
      reasons.push('high rain probability');
    }

    // Extreme heat (>95°F) increases demand for covered lots
    if (weather.temperature_f > 95) {
      factor += 0.08;
      reasons.push('extreme heat');
    }
    // Cold weather (<50°F) slightly increases demand
    else if (weather.temperature_f < 50) {
      factor += 0.05;
      reasons.push('cold weather');
    }

    // High winds
    if (weather.wind_speed_mph > 25) {
      factor += 0.05;
      reasons.push('high winds');
    }

    const description =
      reasons.length > 0
        ? `Weather impact: ${reasons.join(', ')} (+${Math.round((factor - 1) * 100)}% demand)`
        : 'Normal weather conditions';

    return {
      factor: Math.round(factor * 100) / 100,
      description,
      conditions: weather.conditions,
      is_raining: weather.is_raining,
      temperature_f: weather.temperature_f,
    };
  }
}
