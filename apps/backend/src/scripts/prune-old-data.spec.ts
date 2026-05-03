jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';

type WorkFn = (ctx: { app: unknown; logger: unknown }) => Promise<void>;

function loadFresh(): WorkFn {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    require('./prune-old-data');
  });
  const calls = (runCronJob as jest.Mock).mock.calls;
  return calls[calls.length - 1][2];
}

describe('prune-old-data cron', () => {
  beforeEach(() => {
    (runCronJob as jest.Mock).mockClear();
    delete process.env.RETENTION_DAYS;
  });

  it('registers as prune-old-data with [OccupancyEventsModule]', () => {
    loadFresh();
    const call = (runCronJob as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('prune-old-data');
    // Use class name rather than identity: jest.isolateModules re-evaluates
    // the script, which re-requires the module under a fresh module cache.
    expect(call[1]).toHaveLength(1);
    expect((call[1][0] as { name: string }).name).toBe('OccupancyEventsModule');
  });

  it('uses the 30-day default retention when RETENTION_DAYS is unset', async () => {
    const work = loadFresh();
    const svc = {
      pruneOldData: jest
        .fn()
        .mockResolvedValue({ events_deleted: 0, cutoff: '2026-04-03' }),
    };
    const logger = { log: jest.fn() };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app, logger });

    expect(svc.pruneOldData).toHaveBeenCalledWith(30);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('retention=30d'),
    );
  });

  it('honors a numeric RETENTION_DAYS override', async () => {
    process.env.RETENTION_DAYS = '60';
    const work = loadFresh();
    const svc = {
      pruneOldData: jest
        .fn()
        .mockResolvedValue({ events_deleted: 5, cutoff: '2026-03-04' }),
    };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app, logger: { log: jest.fn() } });

    expect(svc.pruneOldData).toHaveBeenCalledWith(60);
  });

  it('throws on a non-numeric or sub-1 RETENTION_DAYS', async () => {
    process.env.RETENTION_DAYS = 'abc';
    const work = loadFresh();
    const app = { get: jest.fn() };
    await expect(work({ app, logger: { log: jest.fn() } })).rejects.toThrow(
      /RETENTION_DAYS must be a number/,
    );

    process.env.RETENTION_DAYS = '0';
    const work2 = loadFresh();
    await expect(work2({ app, logger: { log: jest.fn() } })).rejects.toThrow(
      /RETENTION_DAYS must be a number/,
    );
  });
});
