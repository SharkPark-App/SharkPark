import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule } from '@sentry/nestjs/setup';
import type { Request } from 'express';
import { DatabaseModule } from './database/database.module';
import { LotsModule } from './lots/lots.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { WeatherModule } from './weather/weather.module';
import { AuthModule } from './auth/auth.module';
import { AzureAdGuard } from './auth/azure-ad.guard';
import { TierThrottlerGuard } from './common/guards/tier-throttler.guard';
import { OccupancyEventsModule } from './occupancy-events/occupancy-events.module';
import { ReliabilityModule } from './reliability/reliability.module';
import { ShuttleTrackerModule } from './shuttle-tracker/shuttle-tracker.module';
import { HealthModule } from './health/health.module';
import { ReportsModule } from './reports/reports.module';
import { RedisModule } from './redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { appConfig, authConfig, dbConfig, privacyConfig, weatherConfig, notificationsConfig, validateConfig } from './config/configuration';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, dbConfig, privacyConfig, weatherConfig, notificationsConfig],
      validate: validateConfig,
    }),
    // Sentry must be imported BEFORE other modules that should be instrumented.
    // Init itself happens in src/instrument.ts (loaded first in main.ts).
    SentryModule.forRoot(),
    // JSON structured logging in production, pretty-printed in dev. Request id
    // is set by RequestIdMiddleware (cf-ray honored) and surfaced as `req.id`.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
        genReqId: (req) => (req as Request & { id?: string }).id ?? '',
        // Treat /health/live as a 200-only ping — drop it from request logs to
        // keep prod log volume sane.
        autoLogging: {
          ignore: (req) => req.url === '/api/v1/health/live',
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-events-signature"]',
          ],
          censor: '[REDACTED]',
        },
        customProps: () => ({ service: 'sharkpark-backend' }),
        ...(isProduction
          ? {}
          : {
              transport: {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
              },
            }),
      },
    }),
    DatabaseModule,
    // Tier-aware throttler buckets (selected by TierThrottlerGuard via x-app-mode):
    //   tier-public      — unauthenticated / no contributor ping: 60 req/min
    //   tier-contributor — device with fresh contributor ping:    300 req/min
    //   tier-authed      — Azure AD bearer token present:         600 req/min
    //
    // `read` is a named bucket kept for hot read endpoints that declare an
    // explicit @Throttle({ read: {...} }) override (e.g. LotsController).
    // Those routes bypass the tier buckets and use their own limit directly.
    ThrottlerModule.forRoot([
      { name: 'tier-public', ttl: 60_000, limit: 60 },
      { name: 'tier-contributor', ttl: 60_000, limit: 300 },
      { name: 'tier-authed', ttl: 60_000, limit: 600 },
      { name: 'read', ttl: 60_000, limit: 600 },
    ]),
    LotsModule,
    UsersModule,
    EventsModule,
    WeatherModule,
    AuthModule,
    OccupancyEventsModule,
    ReliabilityModule,
    ShuttleTrackerModule,
    HealthModule,
    ReportsModule,
    RedisModule,
    NotificationsModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: TierThrottlerGuard },
    { provide: APP_GUARD, useExisting: AzureAdGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
