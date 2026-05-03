jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { OccupancyEventsModule } from '../occupancy-events/occupancy-events.module';
import './cleanup-device-states';

type WorkFn = (ctx: { app: unknown; logger: unknown }) => Promise<void>;

describe('cleanup-device-states cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers under cleanup-device-states with [OccupancyEventsModule]', () => {
    expect(call[0]).toBe('cleanup-device-states');
    expect(call[1]).toEqual([OccupancyEventsModule]);
  });

  it('calls cleanupStaleDeviceStates(18h) and logs how many were cleaned', async () => {
    const work = call[2] as WorkFn;
    const svc = {
      cleanupStaleDeviceStates: jest.fn().mockResolvedValue({ cleaned: 7 }),
    };
    const logger = { log: jest.fn() };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app, logger });

    expect(svc.cleanupStaleDeviceStates).toHaveBeenCalledWith(18);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('cleaned 7 stale ENTER records'),
    );
  });
});
