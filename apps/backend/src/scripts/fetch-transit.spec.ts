jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { RedisModule } from '../redis/redis.module';
import { ShuttleTrackerCoreModule } from '../shuttle-tracker/shuttle-tracker-core.module';
import './fetch-transit';

type WorkFn = (ctx: { app: unknown }) => Promise<void>;

describe('fetch-transit cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers as fetch-transit with [RedisModule, ShuttleTrackerCoreModule]', () => {
    expect(call[0]).toBe('fetch-transit');
    expect(call[1]).toEqual([RedisModule, ShuttleTrackerCoreModule]);
  });

  it('calls fetchRoutesAndStops and fetchShuttles in parallel', async () => {
    const work = call[2] as WorkFn;
    const svc = {
      fetchRoutesAndStops: jest.fn().mockResolvedValue(undefined),
      fetchShuttles: jest.fn().mockResolvedValue(undefined),
    };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app });

    expect(svc.fetchRoutesAndStops).toHaveBeenCalledTimes(1);
    expect(svc.fetchShuttles).toHaveBeenCalledTimes(1);
  });
});
