import { NotificationType } from '@prisma/client';

import { NotifySurgeJob } from './notify-surge.job';

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

describe('NotifySurgeJob', () => {
  it('returns early when no lots are above 90%', async () => {
    const prisma = {
      occupancySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn() },
    };
    const notifications = {
      recentlyNotifiedUsers: jest.fn(),
      sendPush: jest.fn(),
      logNotification: jest.fn(),
    };
    const job = new NotifySurgeJob(
      makeRunner() as never,
      prisma as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(notifications.sendPush).not.toHaveBeenCalled();
  });

  it('dedupes school IDs and pushes to opted-in users with dedup + failure branches', async () => {
    const prisma = {
      occupancySnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { lot: { school_id: 'sA' } },
          { lot: { school_id: 'sA' } }, // duplicate
          { lot: { school_id: 'sB' } },
        ]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]) // sA
          .mockResolvedValueOnce([{ id: 'u3' }]),               // sB
      },
    };
    const notifications = {
      recentlyNotifiedUsers: jest
        .fn()
        .mockResolvedValueOnce(new Set(['u2'])) // sA: u2 already notified
        .mockResolvedValueOnce(new Set()),       // sB
      sendPush: jest
        .fn()
        .mockResolvedValueOnce(true)   // u1
        .mockResolvedValueOnce(false), // u3 push fails
      logNotification: jest.fn().mockResolvedValue(undefined),
    };
    const job = new NotifySurgeJob(
      makeRunner() as never,
      prisma as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();

    // Only one user.findMany per unique school
    expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
    // u2 skipped (dedup), u1 + u3 attempted
    expect(notifications.sendPush).toHaveBeenCalledTimes(2);
    // Only u1 logged (u3's push returned false)
    expect(notifications.logNotification).toHaveBeenCalledTimes(1);
    expect(notifications.logNotification).toHaveBeenCalledWith(
      'u1',
      NotificationType.SURGE,
    );
  });
});
