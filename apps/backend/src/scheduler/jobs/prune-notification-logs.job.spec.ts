import { PruneNotificationLogsJob } from './prune-notification-logs.job';

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

describe('PruneNotificationLogsJob', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NOTIFICATION_LOG_RETENTION_DAYS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses the default 90-day retention when env var is unset', async () => {
    const runner = makeRunner();
    const notifications = {
      pruneOldLogs: jest
        .fn()
        .mockResolvedValue({ logs_deleted: 7, cutoff: '2025-01-01T00:00:00.000Z' }),
    };
    const job = new PruneNotificationLogsJob(
      runner as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();
    expect(notifications.pruneOldLogs).toHaveBeenCalledWith(90);
  });

  it('honors a valid override', async () => {
    process.env.NOTIFICATION_LOG_RETENTION_DAYS = '30';
    const runner = makeRunner();
    const notifications = {
      pruneOldLogs: jest
        .fn()
        .mockResolvedValue({ logs_deleted: 0, cutoff: '2025-01-01T00:00:00.000Z' }),
    };
    const job = new PruneNotificationLogsJob(
      runner as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();
    expect(notifications.pruneOldLogs).toHaveBeenCalledWith(30);
  });

  it('throws on a non-numeric override', async () => {
    process.env.NOTIFICATION_LOG_RETENTION_DAYS = 'forever';
    const runner = makeRunner();
    const notifications = { pruneOldLogs: jest.fn() };
    const job = new PruneNotificationLogsJob(
      runner as never,
      notifications as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow(
      'NOTIFICATION_LOG_RETENTION_DAYS must be',
    );
    expect(notifications.pruneOldLogs).not.toHaveBeenCalled();
  });

  it('throws on a < 1 override', async () => {
    process.env.NOTIFICATION_LOG_RETENTION_DAYS = '0';
    const runner = makeRunner();
    const notifications = { pruneOldLogs: jest.fn() };
    const job = new PruneNotificationLogsJob(
      runner as never,
      notifications as never,
      makeLogger(),
    );

    await expect(job.handle()).rejects.toThrow(
      'NOTIFICATION_LOG_RETENTION_DAYS must be',
    );
  });
});
