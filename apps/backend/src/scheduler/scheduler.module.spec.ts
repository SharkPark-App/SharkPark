import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';

import { SchedulerModule } from './scheduler.module';
import { CRON_MONITORS, CRON_TIMEZONE } from './cron-monitors';

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

/**
 * The 18 job classes the SchedulerModule registers as providers. Tuple is
 * the source of truth for "which job classes exist"; the lockstep test
 * below asserts every name in CRON_MONITORS has exactly one matching class
 * and every class's @Cron(...) options match the registered schedule.
 */
const ALL_JOBS = [
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
] as const;

interface CronMetadata {
  name: string;
  cronTime: string;
  timeZone?: string;
}

function readCronMetadata(jobClass: { name: string; prototype: object }): CronMetadata {
  const proto = jobClass.prototype as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const method = proto[key];
    if (typeof method !== 'function') continue;
    const meta = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method) as
      | Record<string, unknown>
      | undefined;
    if (meta) {
      return {
        name: meta.name as string,
        cronTime: meta.cronTime as string,
        timeZone: meta.timeZone as string | undefined,
      };
    }
  }
  throw new Error(`${jobClass.name}: no @Cron(...) decorated method found`);
}

describe('Scheduler job <-> CRON_MONITORS lockstep', () => {
  it('every job class is decorated with a name registered in CRON_MONITORS', () => {
    for (const jobClass of ALL_JOBS) {
      const meta = readCronMetadata(jobClass);
      expect(meta.name).toBeTruthy();
      expect(CRON_MONITORS).toHaveProperty(meta.name);
    }
  });

  it("every job's @Cron schedule matches its CRON_MONITORS entry", () => {
    for (const jobClass of ALL_JOBS) {
      const meta = readCronMetadata(jobClass);
      const monitor = CRON_MONITORS[meta.name as keyof typeof CRON_MONITORS];
      expect(meta.cronTime).toBe(monitor.schedule);
    }
  });

  it("every job declares the canonical TZ", () => {
    for (const jobClass of ALL_JOBS) {
      const meta = readCronMetadata(jobClass);
      expect(meta.timeZone).toBe(CRON_TIMEZONE);
    }
  });

  it('every CRON_MONITORS entry has exactly one matching job class', () => {
    const decoratedNames = ALL_JOBS.map((c) => readCronMetadata(c).name);
    const monitorNames = Object.keys(CRON_MONITORS);

    const missing = monitorNames.filter((n) => !decoratedNames.includes(n));
    const orphaned = decoratedNames.filter(
      (n) => !monitorNames.includes(n),
    );
    expect({ missing, orphaned }).toEqual({ missing: [], orphaned: [] });
    expect(new Set(decoratedNames).size).toBe(decoratedNames.length);
  });
});

/**
 * DI smoke test — compiles SchedulerModule via Nest's TestingModule to ensure
 * every job class can resolve its constructor dependencies. Catches missing
 * `exports:` on imported feature modules (e.g. WeatherModule must export
 * WeatherFetchService for FetchWeatherJob to inject it). The previous
 * lockstep tests above only check decorator metadata; they do NOT exercise
 * Nest's injector, so a missing export would slip through to runtime and
 * crash the cron VM at boot (as happened on Fly with WeatherFetchService).
 */
describe('SchedulerModule DI graph', () => {
  it('compiles with all job dependencies resolvable', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SchedulerModule],
    }).compile();

    // Verify every job provider can actually be resolved from the container.
    for (const jobClass of ALL_JOBS) {
      expect(moduleRef.get(jobClass)).toBeInstanceOf(jobClass);
    }

    await moduleRef.close();
  });
});
