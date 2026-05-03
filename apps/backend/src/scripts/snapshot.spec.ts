jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { OccupancyEventsModule } from '../occupancy-events/occupancy-events.module';
import './snapshot';

type WorkFn = (ctx: { app: unknown; logger: unknown }) => Promise<void>;

describe('snapshot cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers under the snapshot job name with [OccupancyEventsModule]', () => {
    expect(call[0]).toBe('snapshot');
    expect(call[1]).toEqual([OccupancyEventsModule]);
  });

  it('calls OccupancyEventsService.createSnapshots and logs the count', async () => {
    const work = call[2] as WorkFn;
    const svc = {
      createSnapshots: jest
        .fn()
        .mockResolvedValue({ count: 42, timestamp: '2026-05-03T00:00:00Z' }),
    };
    const logger = { log: jest.fn() };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app, logger });

    expect(svc.createSnapshots).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('created 42 occupancy snapshots'),
    );
  });
});
