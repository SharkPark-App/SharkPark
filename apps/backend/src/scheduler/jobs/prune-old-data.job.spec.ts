import { PruneOldDataJob } from './prune-old-data.job';

function makeRunner() {
  return {
    run: jest.fn(async (_name: string, work: () => Promise<void>) => {
      await work();
    }),
  };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

describe('PruneOldDataJob', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.RETENTION_DAYS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses the default 30-day retention when RETENTION_DAYS is unset', async () => {
    const runner = makeRunner();
    const occupancyEvents = {
      pruneOldData: jest
        .fn()
        .mockResolvedValue({ events_deleted: 42, cutoff: '2026-04-04' }),
    };
    const job = new PruneOldDataJob(
      runner as never,
      occupancyEvents as never,
      makeLogger(),
    );

    await job.handle();
    expect(occupancyEvents.pruneOldData).toHaveBeenCalledWith(30);
  });

  it('honors a valid RETENTION_DAYS override', async () => {
    process.env.RETENTION_DAYS = '60';
    const runner = makeRunner();
    const occupancyEvents = {
      pruneOldData: jest
        .fn()
        .mockResolvedValue({ events_deleted: 0, cutoff: '2026-03-04' }),
    };
    const job = new PruneOldDataJob(
      runner as never,
      occupancyEvents as never,
      makeLogger(),
    );

    await job.handle();
    expect(occupancyEvents.pruneOldData).toHaveBeenCalledWith(60);
  });

  it('throws on a non-numeric RETENTION_DAYS', async () => {
    process.env.RETENTION_DAYS = 'forever';
    const runner = makeRunner();
    const occupancyEvents = { pruneOldData: jest.fn() };
    const job = new PruneOldDataJob(
      runner as never,
      occupancyEvents as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow('RETENTION_DAYS must be');
    expect(occupancyEvents.pruneOldData).not.toHaveBeenCalled();
  });

  it('throws on RETENTION_DAYS < 1', async () => {
    process.env.RETENTION_DAYS = '0';
    const runner = makeRunner();
    const occupancyEvents = { pruneOldData: jest.fn() };
    const job = new PruneOldDataJob(
      runner as never,
      occupancyEvents as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow('RETENTION_DAYS must be');
  });
});
