jest.mock('../instrument', () => ({}));

const mockNestFactory = {
  createApplicationContext: jest.fn(),
};
jest.mock('@nestjs/core', () => ({
  NestFactory: mockNestFactory,
}));

const mockSentry = {
  captureCheckIn: jest.fn().mockReturnValue('check-in-id'),
  captureException: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
};
jest.mock('@sentry/nestjs', () => mockSentry);

const mockWithAdvisoryLock = jest.fn();
jest.mock('./_advisory-lock', () => ({
  withAdvisoryLock: (...args: unknown[]) => mockWithAdvisoryLock(...args),
}));

const mockMonitors: Record<string, unknown> = {};
jest.mock('./_cron-monitors', () => ({
  CRON_MONITORS: mockMonitors,
  CRON_TIMEZONE: 'America/New_York',
}));

jest.mock('./_cron-app.module', () => ({
  CronAppModule: {
    withFeatures: jest.fn().mockReturnValue(class FakeCronApp {}),
  },
}));

import { Logger as PinoLogger } from 'nestjs-pino';
import { runCronJob } from './_bootstrap';
import { PrismaService } from '../database/database.module';

const FAKE_POOL = { _pool: true };

function makeApp(extra: Record<string, unknown> = {}) {
  const logger = {
    log: jest.fn(),
    error: jest.fn(),
  };
  const prisma = { pool: FAKE_POOL } as unknown as PrismaService;
  const app = {
    get: jest.fn((token: unknown) => {
      if (token === PinoLogger) return logger;
      if (token === PrismaService) return prisma;
      return extra[String(token)];
    }),
    useLogger: jest.fn(),
    enableShutdownHooks: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { app, logger };
}

describe('runCronJob', () => {
  const exitSpy = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    exitSpy.mockClear();
    consoleErrorSpy.mockClear();
    mockNestFactory.createApplicationContext.mockReset();
    mockWithAdvisoryLock.mockReset();
    mockSentry.captureCheckIn.mockClear().mockReturnValue('check-in-id');
    mockSentry.captureException.mockClear();
    mockSentry.flush.mockClear().mockResolvedValue(true);
    for (const k of Object.keys(mockMonitors)) delete mockMonitors[k];
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
  });

  afterAll(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it('runs work, closes the check-in as ok, and exits 0', async () => {
    mockMonitors['ok-job'] = { schedule: '* * * * *', checkinMargin: 1, maxRuntime: 5 };
    const { app, logger } = makeApp();
    mockNestFactory.createApplicationContext.mockResolvedValue(app);
    mockWithAdvisoryLock.mockImplementation(async (_pool, _name, fn) => {
      await fn();
      return { acquired: true };
    });
    const work = jest.fn().mockResolvedValue(undefined);

    await runCronJob('ok-job', [], work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('starting'));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('complete'));
    expect(mockSentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ monitorSlug: 'ok-job', status: 'in_progress' }),
      expect.any(Object),
    );
    expect(mockSentry.captureCheckIn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        checkInId: 'check-in-id',
        monitorSlug: 'ok-job',
        status: 'ok',
      }),
    );
    expect(app.close).toHaveBeenCalled();
    expect(mockSentry.flush).toHaveBeenCalledWith(2000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('skips and logs when another instance holds the advisory lock', async () => {
    mockMonitors['skip-job'] = { schedule: '* * * * *', checkinMargin: 1, maxRuntime: 5 };
    const { app, logger } = makeApp();
    mockNestFactory.createApplicationContext.mockResolvedValue(app);
    mockWithAdvisoryLock.mockResolvedValue({ acquired: false });
    const work = jest.fn();

    await runCronJob('skip-job', [], work);

    expect(work).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('another instance holds the lock — skipping'),
    );
    // Skip path still closes the check-in as ok (avoids missed-check-in alert)
    expect(mockSentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ok' }),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('captures exceptions, closes check-in as error, and exits 1 when work throws', async () => {
    mockMonitors['fail-job'] = { schedule: '* * * * *', checkinMargin: 1, maxRuntime: 5 };
    const { app, logger } = makeApp();
    mockNestFactory.createApplicationContext.mockResolvedValue(app);
    const boom = new Error('boom');
    mockWithAdvisoryLock.mockImplementation(async (_pool, _name, fn) => {
      await fn();
      return { acquired: true };
    });
    const work = jest.fn().mockRejectedValue(boom);

    await runCronJob('fail-job', [], work);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed: boom'),
      expect.any(String),
    );
    expect(mockSentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'error', monitorSlug: 'fail-job' }),
    );
    expect(mockSentry.captureException).toHaveBeenCalledWith(boom);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('falls back to console.error when bootstrap itself fails', async () => {
    const bootErr = new Error('nest boot failed');
    mockNestFactory.createApplicationContext.mockRejectedValue(bootErr);

    await runCronJob('boot-fail', [], jest.fn());

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('boot-fail] failed before bootstrap'),
      bootErr,
    );
    expect(mockSentry.captureException).toHaveBeenCalledWith(bootErr);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not open a Sentry check-in when no monitor config is registered', async () => {
    const { app } = makeApp();
    mockNestFactory.createApplicationContext.mockResolvedValue(app);
    mockWithAdvisoryLock.mockImplementation(async (_pool, _name, fn) => {
      await fn();
      return { acquired: true };
    });

    await runCronJob('unmonitored', [], jest.fn().mockResolvedValue(undefined));

    expect(mockSentry.captureCheckIn).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not open a Sentry check-in when SENTRY_DSN is unset', async () => {
    mockMonitors['no-dsn'] = { schedule: '* * * * *', checkinMargin: 1, maxRuntime: 5 };
    delete process.env.SENTRY_DSN;
    const { app } = makeApp();
    mockNestFactory.createApplicationContext.mockResolvedValue(app);
    mockWithAdvisoryLock.mockImplementation(async (_pool, _name, fn) => {
      await fn();
      return { acquired: true };
    });

    await runCronJob('no-dsn', [], jest.fn().mockResolvedValue(undefined));

    expect(mockSentry.captureCheckIn).not.toHaveBeenCalled();
  });
});
