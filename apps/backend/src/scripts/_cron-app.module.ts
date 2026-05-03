import { DynamicModule, Module, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule } from '@sentry/nestjs/setup';
import { DatabaseModule } from '../database/database.module';
import {
  appConfig,
  authConfig,
  dbConfig,
  privacyConfig,
  weatherConfig,
  notificationsConfig,
  validateConfig,
} from '../config/configuration';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Per-script Nest module for one-shot cron jobs.
 *
 * Includes only the always-on dependencies every cron needs:
 *   - ConfigModule (env-driven feature configs)
 *   - SentryModule (error capture + check-ins, instrumented in instrument.ts)
 *   - LoggerModule (pino, mirrored from AppModule)
 *   - DatabaseModule (PrismaService — needed for the advisory lock alone)
 *
 * Callers pass the 1–2 feature modules the script actually invokes via
 * `withFeatures([...])`. This avoids loading the full AppModule on every cron
 * tick — most importantly `ShuttleTrackerModule` (opens a PassioGo WebSocket
 * in onModuleInit) and `NotificationsModule` (initializes Firebase Admin).
 *
 * Bootstrapping the full AppModule cost ~180 MB RSS per script. Five
 * concurrent `*&#47;15` cron ticks (snapshot + 4 notify-* jobs) saturated the
 * 1 GB cron VM and triggered OOM kills. Per-script modules drop each
 * bootstrap to ~60 MB so all five fit under 500 MB.
 */
@Module({})
export class CronAppModule {
  static withFeatures(features: Type<unknown>[]): DynamicModule {
    return {
      module: CronAppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            appConfig,
            authConfig,
            dbConfig,
            privacyConfig,
            weatherConfig,
            notificationsConfig,
          ],
          validate: validateConfig,
        }),
        SentryModule.forRoot(),
        LoggerModule.forRoot({
          pinoHttp: {
            level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
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
        ...features,
      ],
    };
  }
}
