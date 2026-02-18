import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { Weather } from '@prisma/client';

/**
 * Service for weather data that may influence parking patterns.
 * Rain or extreme heat typically increases parking demand.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Retrieves current weather conditions for CSULB campus. */
  async getCurrent(): Promise<Weather | null> {
    try {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const weather = await this.prisma.weather.findFirst({
        where: {
          timestamp: { gte: startOfDay, lt: endOfDay },
        },
        orderBy: { timestamp: 'desc' },
      });

      if (!weather) {
        this.logger.warn(`No weather data found for ${startOfDay.toISOString().split('T')[0]}`);
        return null;
      }

      return weather;
    } catch (error) {
      this.logger.error('Failed to fetch current weather', error);
      throw error;
    }
  }
}
