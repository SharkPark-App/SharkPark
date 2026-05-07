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

describe('CronRunnerService — ml_cron_runs tracking', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...ORIGINAL_ENV, SENTRY_DSN: 'https://example.io/123' };
    captureCheckIn.mockReturnValue('checkin-id-1');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function makeTrackedPrisma() {
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'tracked-run-1' });
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      pool: { connect: jest.fn() },
      mlCronRun: { create, update },
    } as never;
    return { prisma, create, update };
  }

  it('inserts RUNNING then UPDATEs SUCCESS with metadata for tracked jobs', async () => {
    const { prisma, create, update } = makeTrackedPrisma();
    const work = jest
      .fn()
      .mockResolvedValue({ model_version: 'v5', predictions_written: 28 });
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockImplementation(async (_pool, _name, w) => ({
        acquired: true,
        result: await w(),
      }));

    const svc = new CronRunnerService(prisma, makeLogger());
    await svc.run('predict-short-term', work);

    expect(create).toHaveBeenCalledWith({
      data: { job_name: 'predict-short-term', status: 'RUNNING' },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateCall.where).toEqual({ id: 'tracked-run-1' });
    expect(updateCall.data).toMatchObject({
      status: 'SUCCESS',
      metadata: { model_version: 'v5', predictions_written: 28 },
    });
    expect(typeof updateCall.data.duration_ms).toBe('number');
    expect(updateCall.data.completed_at).toBeInstanceOf(Date);
  });

  it('marks SKIPPED when the advisory lock is busy', async () => {
    const { prisma, create, update } = makeTrackedPrisma();
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockResolvedValue({ acquired: false });

    const svc = new CronRunnerService(prisma, makeLogger());
    await svc.run('predict-short-term', jest.fn());

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: 'tracked-run-1' },
      data: expect.objectContaining({ status: 'SKIPPED' }),
    });
  });

  it('marks FAILED with error_message and re-throws on work() failure', async () => {
    const { prisma, create, update } = makeTrackedPrisma();
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockImplementation(async (_pool, _name, w) => {
        await w();
        return { acquired: true, result: undefined };
      });
    const work = jest.fn().mockRejectedValue(new Error('python crashed'));

    const svc = new CronRunnerService(prisma, makeLogger());
    await expect(svc.run('predict-short-term', work)).rejects.toThrow(
      'python crashed',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: 'tracked-run-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        error_message: 'python crashed',
      }),
    });
  });

  it('does NOT touch ml_cron_runs for non-tracked jobs', async () => {
    const { prisma, create, update } = makeTrackedPrisma();
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockImplementation(async (_pool, _name, w) => {
        await w();
        return { acquired: true, result: undefined };
      });

    const svc = new CronRunnerService(prisma, makeLogger());
    await svc.run('snapshot', jest.fn().mockResolvedValue(undefined));

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('continues running work when the tracking insert fails', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const update = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      pool: { connect: jest.fn() },
      mlCronRun: { create, update },
    } as never;
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockImplementation(async (_pool, _name, w) => {
        await w();
        return { acquired: true, result: undefined };
      });
    const work = jest.fn().mockResolvedValue(undefined);

    const svc = new CronRunnerService(prisma, makeLogger());
    await svc.run('predict-short-term', work);

    expect(create).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    // No tracked-run row exists, so update is never attempted.
    expect(update).not.toHaveBeenCalled();
  });

  it('drops non-JSON-serializable metadata silently', async () => {
    const { prisma, update } = makeTrackedPrisma();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    jest
      .spyOn(advisoryLock, 'withAdvisoryLock')
      .mockImplementation(async (_pool, _name, w) => ({
        acquired: true,
        result: await w(),
      }));

    const svc = new CronRunnerService(prisma, makeLogger());
    await svc.run(
      'predict-short-term',
      jest.fn().mockResolvedValue(circular),
    );

    const updateCall = update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).not.toHaveProperty('metadata');
    expect(updateCall.data).toMatchObject({ status: 'SUCCESS' });
  });
});
