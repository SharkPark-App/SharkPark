import { PruneOldEventsJob } from './prune-old-events.job';

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

describe('PruneOldEventsJob', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EVENT_RETENTION_DAYS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses the default 90-day retention when EVENT_RETENTION_DAYS is unset', async () => {
    const runner = makeRunner();
    const events = {
      pruneOldEvents: jest
        .fn()
        .mockResolvedValue({ events_deleted: 12, cutoff: new Date() }),
    };
    const job = new PruneOldEventsJob(
      runner as never,
      events as never,
      makeLogger(),
    );

    await job.handle();
    expect(events.pruneOldEvents).toHaveBeenCalledWith(90);
  });

  it('honors a valid EVENT_RETENTION_DAYS override', async () => {
    process.env.EVENT_RETENTION_DAYS = '14';
    const runner = makeRunner();
    const events = {
      pruneOldEvents: jest
        .fn()
        .mockResolvedValue({ events_deleted: 0, cutoff: new Date() }),
    };
    const job = new PruneOldEventsJob(
      runner as never,
      events as never,
      makeLogger(),
    );

    await job.handle();
    expect(events.pruneOldEvents).toHaveBeenCalledWith(14);
  });

  it('throws on a non-numeric EVENT_RETENTION_DAYS', async () => {
    process.env.EVENT_RETENTION_DAYS = 'never';
    const runner = makeRunner();
    const events = { pruneOldEvents: jest.fn() };
    const job = new PruneOldEventsJob(
      runner as never,
      events as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow('EVENT_RETENTION_DAYS must be');
    expect(events.pruneOldEvents).not.toHaveBeenCalled();
  });

  it('throws on EVENT_RETENTION_DAYS < 1', async () => {
    process.env.EVENT_RETENTION_DAYS = '0';
    const runner = makeRunner();
    const events = { pruneOldEvents: jest.fn() };
    const job = new PruneOldEventsJob(
      runner as never,
      events as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow('EVENT_RETENTION_DAYS must be');
  });
});
