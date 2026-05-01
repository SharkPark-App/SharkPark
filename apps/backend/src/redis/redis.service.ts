import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * General service for interfacing w/ Redis (hosted on Fly).
 * Allows for container-independent data transfer via sharkpark-cache.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis | null = null;
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', '');
    if (!url) {
      this.logger.warn('REDIS_URL not set — Redis cache disabled, using in-memory state only');
      return;
    }
    this.client = new Redis(url, {
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
    this.client.on('error', (err: Error) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const value = await this.client.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      this.logger.warn(`Redis get failed for key "${key}"`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
    } catch {
      this.logger.warn(`Redis set failed for key "${key}"`);
    }
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }
}
