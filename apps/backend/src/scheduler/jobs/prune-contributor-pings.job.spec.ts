import { PruneContributorPingsJob } from './prune-contributor-pings.job';

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

describe('PruneContributorPingsJob', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CONTRIBUTOR_PING_RETENTION_DAYS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses the default 180-day idle window when env var is unset', async () => {
    const runner = makeRunner();
    const contributor = {
      pruneIdlePings: jest
        .fn()
        .mockResolvedValue({ pings_deleted: 4, cutoff: '2025-01-01T00:00:00.000Z' }),
    };
    const job = new PruneContributorPingsJob(
      runner as never,
      contributor as never,
      makeLogger(),
    );

    await job.handle();
    expect(contributor.pruneIdlePings).toHaveBeenCalledWith(180);
  });

  it('honors a valid override', async () => {
    process.env.CONTRIBUTOR_PING_RETENTION_DAYS = '60';
    const runner = makeRunner();
    const contributor = {
      pruneIdlePings: jest
        .fn()
        .mockResolvedValue({ pings_deleted: 1, cutoff: '2025-01-01T00:00:00.000Z' }),
    };
    const job = new PruneContributorPingsJob(
      runner as never,
      contributor as never,
      makeLogger(),
    );

    await job.handle();
    expect(contributor.pruneIdlePings).toHaveBeenCalledWith(60);
  });

  it('throws on a non-numeric override', async () => {
    process.env.CONTRIBUTOR_PING_RETENTION_DAYS = 'never';
    const runner = makeRunner();
    const contributor = { pruneIdlePings: jest.fn() };
    const job = new PruneContributorPingsJob(
      runner as never,
      contributor as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow(
      'CONTRIBUTOR_PING_RETENTION_DAYS must be',
    );
    expect(contributor.pruneIdlePings).not.toHaveBeenCalled();
  });

  it('throws on a < 1 override', async () => {
    process.env.CONTRIBUTOR_PING_RETENTION_DAYS = '-1';
    const runner = makeRunner();
    const contributor = { pruneIdlePings: jest.fn() };
    const job = new PruneContributorPingsJob(
      runner as never,
      contributor as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow(
      'CONTRIBUTOR_PING_RETENTION_DAYS must be',
    );
  });
});
