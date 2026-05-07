import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule } from '@sentry/nestjs/setup';

import { DatabaseModule } from '../database/database.module';
import { OccupancyEventsModule } from '../occupancy-events/occupancy-events.module';
import { WeatherModule } from '../weather/weather.module';
import { RedisModule } from '../redis/redis.module';
import { ShuttleTrackerCoreModule } from '../shuttle-tracker/shuttle-tracker-core.module';
import { EventsModule } from '../events/events.module';
import { EventsScrapersModule } from '../events/events-scrapers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContributorService } from '../auth/contributor.service';
import { ReportsService } from '../reports/reports.service';
import { ConsensusService } from '../reliability/consensus.service';
import {
  appConfig,
  authConfig,
  dbConfig,
  privacyConfig,
  weatherConfig,
  notificationsConfig,
  validateConfig,
} from '../config/configuration';

import { CronRunnerService } from './cron-runner.service';

import { SnapshotJob } from './jobs/snapshot.job';
import { FetchWeatherJob } from './jobs/fetch-weather.job';
import { FetchWeatherForecastJob } from './jobs/fetch-weather-forecast.job';
import { FetchTransitJob } from './jobs/fetch-transit.job';
import { CleanupDeviceStatesJob } from './jobs/cleanup-device-states.job';
import { BackupDbJob } from './jobs/backup-db.job';
import { VerifyLatestBackupJob } from './jobs/verify-latest-backup.job';
import { PruneOldDataJob } from './jobs/prune-old-data.job';
import { PruneOldEventsJob } from './jobs/prune-old-events.job';
import { FetchEventsJob } from './jobs/fetch-events.job';
import { FetchSportsEventsJob } from './jobs/fetch-sports-events.job';
import { RefreshSportsFinalsJob } from './jobs/refresh-sports-finals.job';
import { NotifyFavoritesFillingJob } from './jobs/notify-favorites-filling.job';
import { NotifyFavoritesClearingJob } from './jobs/notify-favorites-clearing.job';
import { NotifySurgeJob } from './jobs/notify-surge.job';
import { NotifyEventsJob } from './jobs/notify-events.job';
import { RefreshLotAdvisoriesJob } from './jobs/refresh-lot-advisories.job';
import { RefreshLotMetadataJob } from './jobs/refresh-lot-metadata.job';
import { PruneNotificationLogsJob } from './jobs/prune-notification-logs.job';
import { PruneContributorPingsJob } from './jobs/prune-contributor-pings.job';
import { PruneOldReportMessagesJob } from './jobs/prune-old-report-messages.job';
import { PredictShortTermJob } from './jobs/predict-short-term.job';
import { PredictLongTermJob } from './jobs/predict-long-term.job';
import { RecomputePenetrationRatesJob } from './jobs/recompute-penetration-rates.job';
import { IngestCsulbCatalogJob } from './jobs/ingest-csulb-catalog.job';
import { IngestRoomCapacitiesJob } from './jobs/ingest-room-capacities.job';
import { BuildProximityMatrixJob } from './jobs/build-proximity-matrix.job';
import { PruneConsensusObservationsJob } from './jobs/prune-consensus-observations.job';
import { PredictionAccuracyJob } from './jobs/prediction-accuracy.job';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Single long-running NestJS context that owns every scheduled cron job.
 *
 * This replaces the per-script bootstrap pattern (`src/scripts/_bootstrap.ts`
 * + supercronic) that caused OOM cascades on the cron VM at the top of every
 * 15-minute slot — 5 concurrent supercronic children each spawning a fresh
 * Nest module graph (~180MB RSS) saturated the 1GB VM, exit 137 followed.
 *
 * Architecture:
 *   - `ScheduleModule.forRoot()` registers `@Cron(...)` methods on every
 *     job class as in-process timers.
 *   - One `CronRunnerService` wraps each tick with a Sentry check-in +
 *     Postgres advisory lock + structured error capture.
 *   - Feature modules below are loaded ONCE at process start; per-tick cost
 *     is just the body of the job method.
 *
 * Steady-state RSS is ~250MB regardless of how many ticks fire concurrently.
 * Cron VM is downsized to 512MB in fly.toml accordingly.
 */
@Module({
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
        customProps: () => ({ service: 'sharkpark-backend', proc: 'scheduler' }),
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
    ScheduleModule.forRoot(),
    DatabaseModule,
    OccupancyEventsModule,
    WeatherModule,
    RedisModule,
    // Lightweight shuttle module (no PassioGo WebSocket, no Socket.IO gateway).
    ShuttleTrackerCoreModule,
    // EventsModule re-exports EventsScrapersModule so we get both
    // EventsService (for prune-old-events) and the scrapers.
    EventsModule,
    EventsScrapersModule,
    NotificationsModule,
  ],
  providers: [
    CronRunnerService,
    // Direct providers (not via AuthModule / ReportsModule) — the scheduler
    // only needs the service classes themselves, not their controllers,
    // strategies, or guards. Both depend solely on PrismaService, which
    // is available through DatabaseModule above.
    ContributorService,
    ReportsService,
    ConsensusService,
    SnapshotJob,
    FetchWeatherJob,
    FetchWeatherForecastJob,
    FetchTransitJob,
    CleanupDeviceStatesJob,
    BackupDbJob,
    VerifyLatestBackupJob,
    PruneOldDataJob,
    PruneOldEventsJob,
    FetchEventsJob,
    FetchSportsEventsJob,
    RefreshSportsFinalsJob,
    NotifyFavoritesFillingJob,
    NotifyFavoritesClearingJob,
    NotifySurgeJob,
    NotifyEventsJob,
    RefreshLotAdvisoriesJob,
    RefreshLotMetadataJob,
    PruneNotificationLogsJob,
    PruneContributorPingsJob,
    PruneOldReportMessagesJob,
    PredictShortTermJob,
    PredictLongTermJob,
    RecomputePenetrationRatesJob,
    IngestCsulbCatalogJob,
    IngestRoomCapacitiesJob,
    BuildProximityMatrixJob,
    PruneConsensusObservationsJob,
    PredictionAccuracyJob,
  ],
})
export class SchedulerModule {}
