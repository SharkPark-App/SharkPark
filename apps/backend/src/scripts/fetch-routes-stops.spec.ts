jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { RedisModule } from '../redis/redis.module';
import { ShuttleTrackerCoreModule } from '../shuttle-tracker/shuttle-tracker-core.module';
import './fetch-routes-stops';

type WorkFn = (ctx: { app: unknown }) => Promise<void>;

describe('fetch-routes-stops cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers as fetch-routes-stops with [RedisModule, ShuttleTrackerCoreModule]', () => {
    expect(call[0]).toBe('fetch-routes-stops');
    expect(call[1]).toEqual([RedisModule, ShuttleTrackerCoreModule]);
  });

  it('calls fetchRoutesAndStops', async () => {
    const work = call[2] as WorkFn;
    const svc = {
      fetchRoutesAndStops: jest.fn().mockResolvedValue(undefined),
      fetchShuttles: jest.fn(),
    };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app });

    expect(svc.fetchRoutesAndStops).toHaveBeenCalledTimes(1);
    expect(svc.fetchShuttles).not.toHaveBeenCalled();
  });
});
