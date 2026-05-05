/**
 * Tests for the trivial wrapper jobs whose `handle()` implementation is
 * just `runner.run(NAME, () => service.someMethod())`. We only assert:
 *   1. handle() delegates to runner.run with the matching cron name, and
 *   2. the work fn passed to the runner invokes the underlying service
 *      method exactly once.
 *
 * The Sentry/advisory-lock semantics are owned by CronRunnerService and
 * covered by its own spec.
 */
import { CleanupDeviceStatesJob } from './cleanup-device-states.job';
import { FetchEventsJob } from './fetch-events.job';
import { FetchSportsEventsJob } from './fetch-sports-events.job';
import { FetchTransitJob } from './fetch-transit.job';
import { FetchWeatherJob } from './fetch-weather.job';
import { FetchWeatherForecastJob } from './fetch-weather-forecast.job';
import { RefreshSportsFinalsJob } from './refresh-sports-finals.job';
import { SnapshotJob } from './snapshot.job';

type RunnerLike = {
  run: jest.Mock<Promise<void>, [string, () => Promise<void>]>;
};

function makeRunner(): RunnerLike {
  return {
    run: jest.fn(async (_name: string, work: () => Promise<void>) => {
      await work();
    }),
  };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

describe('SnapshotJob', () => {
  it('delegates to occupancyEvents.createSnapshots', async () => {
    const runner = makeRunner();
    const occupancyEvents = {
      createSnapshots: jest
        .fn()
        .mockResolvedValue({ count: 7, timestamp: '2026-05-04T00:00:00Z' }),
    };
    const job = new SnapshotJob(
      runner as never,
      occupancyEvents as never,
      makeLogger(),
    );

    await job.handle();
    expect(runner.run).toHaveBeenCalledWith('snapshot', expect.any(Function));
    expect(occupancyEvents.createSnapshots).toHaveBeenCalledTimes(1);
  });
});

describe('CleanupDeviceStatesJob', () => {
  it('cleans stale ENTER records with the configured age', async () => {
    const runner = makeRunner();
    const occupancyEvents = {
      cleanupStaleDeviceStates: jest.fn().mockResolvedValue({ cleaned: 3 }),
    };
    const job = new CleanupDeviceStatesJob(
      runner as never,
      occupancyEvents as never,
      makeLogger(),
    );

    await job.handle();
    expect(runner.run).toHaveBeenCalledWith(
      'cleanup-device-states',
      expect.any(Function),
    );
    expect(occupancyEvents.cleanupStaleDeviceStates).toHaveBeenCalledWith(18);
  });
});

describe('FetchEventsJob', () => {
  it('invokes EventsScraperService.scrapeAll', async () => {
    const runner = makeRunner();
    const scraper = { scrapeAll: jest.fn().mockResolvedValue(undefined) };
    const job = new FetchEventsJob(runner as never, scraper as never);

    await job.handle();
    expect(runner.run).toHaveBeenCalledWith(
      'fetch-events',
      expect.any(Function),
    );
    expect(scraper.scrapeAll).toHaveBeenCalledTimes(1);
  });
});

describe('FetchSportsEventsJob', () => {
  it('invokes SportsEventsScraperService.scrapeAll', async () => {
    const runner = makeRunner();
    const scraper = { scrapeAll: jest.fn().mockResolvedValue(undefined) };
    const job = new FetchSportsEventsJob(runner as never, scraper as never);

    await job.handle();
    expect(runner.run).toHaveBeenCalledWith(
      'fetch-sports-events',
      expect.any(Function),
    );
    expect(scraper.scrapeAll).toHaveBeenCalledTimes(1);
  });
});

describe('FetchTransitJob', () => {
  it('fetches routes/stops then shuttles, in order', async () => {
    const runner = makeRunner();
    const calls: string[] = [];
    const shuttle = {
      fetchRoutesAndStops: jest.fn(async () => {
        calls.push('routes');
      }),
      fetchShuttles: jest.fn(async () => {
        calls.push('shuttles');
      }),
    };
    const job = new FetchTransitJob(runner as never, shuttle as never);

    await job.handle();
    expect(runner.run).toHaveBeenCalledWith(
      'fetch-transit',
      expect.any(Function),
    );
    expect(calls).toEqual(['routes', 'shuttles']);
  });
});

describe('FetchWeatherJob', () => {
  it('invokes WeatherFetchService.fetchWeather', async () => {
    const runner = makeRunner();
    const weather = { fetchWeather: jest.fn().mockResolvedValue(undefined) };
    const job = new FetchWeatherJob(runner as never, weather as never);

    await job.handle();
    expect(runner.run).toHaveBeenCalledWith(
      'fetch-weather',
      expect.any(Function),
    );
    expect(weather.fetchWeather).toHaveBeenCalledTimes(1);
  });
});

describe('FetchWeatherForecastJob', () => {
  it('invokes WeatherForecastFetchService.fetchForecast', async () => {
    const runner = makeRunner();
    const forecast = { fetchForecast: jest.fn().mockResolvedValue(undefined) };
    const job = new FetchWeatherForecastJob(
      runner as never,
      forecast as never,
    );

    await job.handle();
    expect(runner.run).toHaveBeenCalledWith(
      'fetch-weather-forecast',
      expect.any(Function),
    );
    expect(forecast.fetchForecast).toHaveBeenCalledTimes(1);
  });
});

describe('RefreshSportsFinalsJob', () => {
  it('invokes SportsEventsScraperService.refreshFinalScores', async () => {
    const runner = makeRunner();
    const scraper = {
      refreshFinalScores: jest.fn().mockResolvedValue(undefined),
    };
    const job = new RefreshSportsFinalsJob(runner as never, scraper as never);

    await job.handle();
    expect(runner.run).toHaveBeenCalledWith(
      'refresh-sports-finals',
      expect.any(Function),
    );
    expect(scraper.refreshFinalScores).toHaveBeenCalledTimes(1);
  });
});
