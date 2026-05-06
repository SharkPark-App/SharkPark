import { NotificationType } from '@prisma/client';

import { NotifyFavoritesFillingJob } from './notify-favorites-filling.job';

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

describe('NotifyFavoritesFillingJob', () => {
  it('returns early when no lots are above 80%', async () => {
    const prisma = {
      occupancySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      userFavorite: { findMany: jest.fn() },
    };
    const notifications = {
      recentlyNotifiedUsers: jest.fn(),
      sendPush: jest.fn(),
      logNotification: jest.fn(),
    };
    const job = new NotifyFavoritesFillingJob(
      makeRunner() as never,
      prisma as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();
    expect(prisma.userFavorite.findMany).not.toHaveBeenCalled();
    expect(notifications.sendPush).not.toHaveBeenCalled();
  });

  it('pushes to opted-in favoriters and respects dedup + push-failure branches', async () => {
    const prisma = {
      occupancySnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { lot_id: 'lotA', lot: { display_name: 'Lot A' } },
        ]),
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
        .mockResolvedValueOnce(true)   // u1
        .mockResolvedValueOnce(false), // u3
      logNotification: jest.fn().mockResolvedValue(undefined),
    };
    const job = new NotifyFavoritesFillingJob(
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
      NotificationType.FAVORITES_FILLING,
      { lotId: 'lotA' },
    );
  });
});
