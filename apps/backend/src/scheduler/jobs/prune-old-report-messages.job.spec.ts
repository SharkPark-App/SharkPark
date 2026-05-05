import { PruneOldReportMessagesJob } from './prune-old-report-messages.job';

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

describe('PruneOldReportMessagesJob', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.REPORT_MESSAGE_RETENTION_DAYS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses the default 90-day retention when env var is unset', async () => {
    const runner = makeRunner();
    const reports = {
      pruneOldMessages: jest
        .fn()
        .mockResolvedValue({ messages_redacted: 3, cutoff: '2025-01-01T00:00:00.000Z' }),
    };
    const job = new PruneOldReportMessagesJob(
      runner as never,
      reports as never,
      makeLogger(),
    );

    await job.handle();
    expect(reports.pruneOldMessages).toHaveBeenCalledWith(90);
  });

  it('honors a valid override', async () => {
    process.env.REPORT_MESSAGE_RETENTION_DAYS = '30';
    const runner = makeRunner();
    const reports = {
      pruneOldMessages: jest
        .fn()
        .mockResolvedValue({ messages_redacted: 0, cutoff: '2025-01-01T00:00:00.000Z' }),
    };
    const job = new PruneOldReportMessagesJob(
      runner as never,
      reports as never,
      makeLogger(),
    );

    await job.handle();
    expect(reports.pruneOldMessages).toHaveBeenCalledWith(30);
  });

  it('throws on a non-numeric override', async () => {
    process.env.REPORT_MESSAGE_RETENTION_DAYS = 'forever';
    const runner = makeRunner();
    const reports = { pruneOldMessages: jest.fn() };
    const job = new PruneOldReportMessagesJob(
      runner as never,
      reports as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow(
      'REPORT_MESSAGE_RETENTION_DAYS must be',
    );
    expect(reports.pruneOldMessages).not.toHaveBeenCalled();
  });

  it('throws on a < 1 override', async () => {
    process.env.REPORT_MESSAGE_RETENTION_DAYS = '0';
    const runner = makeRunner();
    const reports = { pruneOldMessages: jest.fn() };
    const job = new PruneOldReportMessagesJob(
      runner as never,
      reports as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow(
      'REPORT_MESSAGE_RETENTION_DAYS must be',
    );
  });
});
