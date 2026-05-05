jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { RedisModule } from '../redis/redis.module';
import { ShuttleTrackerCoreModule } from '../shuttle-tracker/shuttle-tracker-core.module';
import './fetch-shuttles';

type WorkFn = (ctx: { app: unknown }) => Promise<void>;

describe('fetch-shuttles cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers as fetch-shuttles with [RedisModule, ShuttleTrackerCoreModule]', () => {
    expect(call[0]).toBe('fetch-shuttles');
    expect(call[1]).toEqual([RedisModule, ShuttleTrackerCoreModule]);
  });

  it('calls fetchShuttles', async () => {
    const work = call[2] as WorkFn;
    const svc = {
      fetchShuttles: jest.fn().mockResolvedValue(undefined),
      fetchRoutesAndStops: jest.fn(),
    };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app });

    expect(svc.fetchShuttles).toHaveBeenCalledTimes(1);
    expect(svc.fetchRoutesAndStops).not.toHaveBeenCalled();
  });
});