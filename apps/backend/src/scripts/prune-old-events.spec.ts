jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { EventsModule } from '../events/events.module';
import { EventsService } from '../events/events.service';
import './prune-old-events';

type WorkFn = (ctx: { app: unknown; logger: { log: jest.Mock } }) => Promise<void>;

describe('prune-old-events cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];
  const work = call[2] as WorkFn;
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('registers under prune-old-events with [EventsModule]', () => {
    expect(call[0]).toBe('prune-old-events');
    expect(call[1]).toEqual([EventsModule]);
  });

  it('uses the 90-day default retention when EVENT_RETENTION_DAYS is unset', async () => {
    delete process.env.EVENT_RETENTION_DAYS;
    const svc = {
      pruneOldEvents: jest.fn().mockResolvedValue({
        events_deleted: 12,
        cutoff: new Date('2026-02-03T00:00:00Z'),
      }),
    };
    const app = { get: jest.fn().mockReturnValue(svc) };
    const logger = { log: jest.fn() };

    await work({ app, logger });

    expect(app.get).toHaveBeenCalledWith(EventsService);
    expect(svc.pruneOldEvents).toHaveBeenCalledWith(90);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('retention=90d events=12'),
    );
  });

  it('honors a numeric EVENT_RETENTION_DAYS override', async () => {
    process.env.EVENT_RETENTION_DAYS = '30';
    const svc = {
      pruneOldEvents: jest.fn().mockResolvedValue({
        events_deleted: 0,
        cutoff: new Date(),
      }),
    };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app, logger: { log: jest.fn() } });

    expect(svc.pruneOldEvents).toHaveBeenCalledWith(30);
  });

  it('throws on a non-numeric or sub-1 EVENT_RETENTION_DAYS', async () => {
    const app = { get: jest.fn() };
    const logger = { log: jest.fn() };

    process.env.EVENT_RETENTION_DAYS = 'abc';
    await expect(work({ app, logger })).rejects.toThrow(
      /EVENT_RETENTION_DAYS must be a number/,
    );

    process.env.EVENT_RETENTION_DAYS = '0';
    await expect(work({ app, logger })).rejects.toThrow(
      /EVENT_RETENTION_DAYS must be a number/,
    );
  });
});
