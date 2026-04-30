import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule } from '@sentry/nestjs/setup';
import type { Request } from 'express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { LotsModule } from './lots/lots.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { WeatherModule } from './weather/weather.module';
import { AuthModule } from './auth/auth.module';
import { AzureAdGuard } from './auth/azure-ad.guard';
import { OccupancyEventsModule } from './occupancy-events/occupancy-events.module';
import { ReliabilityModule } from './reliability/reliability.module';
import { HealthModule } from './health/health.module';
import { ReportsModule } from './reports/reports.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { appConfig, authConfig, dbConfig, privacyConfig, weatherConfig, validateConfig } from './config/configuration';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, dbConfig, privacyConfig, weatherConfig],
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
    // Two named throttler buckets:
    //   `default` — short burst limit applied globally for safety (auth/mutations)
    //   `read`    — relaxed limit for hot read endpoints behind shared NAT
    //               (e.g. campus Wi-Fi: hundreds of devices share one IP)
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 10_000, limit: 20 },
      { name: 'read', ttl: 60_000, limit: 600 },
    ]),
    LotsModule,
    UsersModule,
    EventsModule,
    WeatherModule,
    AuthModule,
    OccupancyEventsModule,
    ReliabilityModule,
    HealthModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AzureAdGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
