import * as Sentry from '@sentry/nestjs';

import { CronRunnerService } from './cron-runner.service';
import * as advisoryLock from './advisory-lock';

jest.mock('@sentry/nestjs', () => ({
  __esModule: true,
  captureCheckIn: jest.fn(),
  captureException: jest.fn(),
}));

const captureCheckIn = Sentry.captureCheckIn as unknown as jest.Mock;
const captureException = Sentry.captureException as unknown as jest.Mock;

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

const fakePrisma = { pool: { connect: jest.fn() } } as never;

describe('CronRunnerService', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...ORIGINAL_ENV, SENTRY_DSN: 'https://example.io/123' };
    captureCheckIn.mockReturnValue('checkin-id-1');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('opens an in_progress check-in, runs the work, and closes ok', async () => {
    const work = jest.fn().mockResolvedValue(undefined);
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockImplementation(async (_pool, _name, w) => {
        await w();
        return { acquired: true, result: undefined };
      });

    const svc = new CronRunnerService(fakePrisma, makeLogger());
    await svc.run('snapshot', work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: 'snapshot', status: 'in_progress' },
      expect.objectContaining({
        schedule: { type: 'crontab', value: '*/15 * * * *' },
        timezone: 'America/Los_Angeles',
      }),
    );
    expect(captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: 'checkin-id-1',
      monitorSlug: 'snapshot',
      status: 'ok',
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('closes the check-in ok and skips work when the advisory lock is busy', async () => {
    const work = jest.fn();
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockResolvedValue({ acquired: false });

    const svc = new CronRunnerService(fakePrisma, makeLogger());
    await svc.run('snapshot', work);

    expect(work).not.toHaveBeenCalled();
    expect(captureCheckIn).toHaveBeenLastCalledWith({
      checkInId: 'checkin-id-1',
      monitorSlug: 'snapshot',
      status: 'ok',
    });
  });

  it('closes the check-in error, captures the exception, and re-throws on failure', async () => {
    const boom = new Error('work blew up');
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockImplementation(async (_pool, _name, w) => {
        await w();
        return { acquired: true, result: undefined };
      });
    const work = jest.fn().mockRejectedValue(boom);

    const svc = new CronRunnerService(fakePrisma, makeLogger());
    await expect(svc.run('snapshot', work)).rejects.toThrow('work blew up');

    expect(captureCheckIn).toHaveBeenLastCalledWith({
      checkInId: 'checkin-id-1',
      monitorSlug: 'snapshot',
      status: 'error',
    });
    expect(captureException).toHaveBeenCalledWith(boom);
  });

  it('skips Sentry calls entirely when SENTRY_DSN is unset', async () => {
    delete process.env.SENTRY_DSN;
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockResolvedValue({ acquired: true, result: undefined });

    const svc = new CronRunnerService(fakePrisma, makeLogger());
    await svc.run('snapshot', jest.fn().mockResolvedValue(undefined));

    expect(captureCheckIn).not.toHaveBeenCalled();
  });
});
