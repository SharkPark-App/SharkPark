import { NotificationType } from '@prisma/client';

import { NotifyFavoritesClearingJob } from './notify-favorites-clearing.job';

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

describe('NotifyFavoritesClearingJob', () => {
  it('returns early when no lots are below 30%', async () => {
    const prisma = {
      occupancySnapshot: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn(),
      },
      userFavorite: { findMany: jest.fn() },
    };
    const notifications = {
      recentlyNotifiedUsers: jest.fn(),
      sendPush: jest.fn(),
      logNotification: jest.fn(),
    };
    const job = new NotifyFavoritesClearingJob(
      makeRunner() as never,
      prisma as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();
    expect(prisma.occupancySnapshot.aggregate).not.toHaveBeenCalled();
    expect(notifications.sendPush).not.toHaveBeenCalled();
  });

  it('returns early when no low lot was previously above 75%', async () => {
    const prisma = {
      occupancySnapshot: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { lot_id: 'lotA', lot: { display_name: 'Lot A' } },
          ]),
        // prior window peaked at 50% — no transition
        aggregate: jest
          .fn()
          .mockResolvedValue({ _max: { occupancy_rate: 0.5 } }),
      },
      userFavorite: { findMany: jest.fn() },
    };
    const notifications = {
      recentlyNotifiedUsers: jest.fn(),
      sendPush: jest.fn(),
      logNotification: jest.fn(),
    };
    const job = new NotifyFavoritesClearingJob(
      makeRunner() as never,
      prisma as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();
    expect(prisma.userFavorite.findMany).not.toHaveBeenCalled();
    expect(notifications.sendPush).not.toHaveBeenCalled();
  });

  it('notifies favoriters when a lot transitions from >75% to <30%', async () => {
    const prisma = {
      occupancySnapshot: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { lot_id: 'lotA', lot: { display_name: 'Lot A' } },
          ]),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _max: { occupancy_rate: 0.9 } }),
      },
      userFavorite: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { user_id: 'u1' },
            { user_id: 'u2' },
            { user_id: 'u3' },
          ]),
      },
    };
    const notifications = {
      recentlyNotifiedUsers: jest.fn().mockResolvedValue(new Set(['u2'])),
      sendPush: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      logNotification: jest.fn().mockResolvedValue(undefined),
    };
    const job = new NotifyFavoritesClearingJob(
      makeRunner() as never,
      prisma as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();

    expect(notifications.sendPush).toHaveBeenCalledTimes(2);
    expect(notifications.logNotification).toHaveBeenCalledTimes(1);
    expect(notifications.logNotification).toHaveBeenCalledWith(
      'u1',
      NotificationType.FAVORITES_CLEARING,
      { lotId: 'lotA' },
    );
  });
});
