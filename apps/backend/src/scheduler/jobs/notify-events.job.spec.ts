import { NotificationType } from '@prisma/client';

import { NotifyEventsJob } from './notify-events.job';

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

describe('NotifyEventsJob', () => {
  it('returns early when no upcoming events fall in the 2-hour window', async () => {
    const prisma = {
      campusEvent: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn() },
    };
    const notifications = {
      recentlyNotifiedUsers: jest.fn(),
      sendPush: jest.fn(),
      logNotification: jest.fn(),
    };
    const job = new NotifyEventsJob(
      makeRunner() as never,
      prisma as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(notifications.sendPush).not.toHaveBeenCalled();
  });

  it('sends push for opted-in users, skips already-notified, and logs only on push success', async () => {
    const event = {
      id: 'evt1',
      school_id: 'school1',
      event_name: 'Game Day',
      start_time: new Date('2026-05-04T20:00:00Z'),
      school: { timezone: 'America/Los_Angeles' },
    };
    const prisma = {
      campusEvent: { findMany: jest.fn().mockResolvedValue([event]) },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]),
      },
    };
    const notifications = {
      recentlyNotifiedUsers: jest.fn().mockResolvedValue(new Set(['u2'])),
      // u1 succeeds, u3 fails (push provider returned false)
      sendPush: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      logNotification: jest.fn().mockResolvedValue(undefined),
    };
    const job = new NotifyEventsJob(
      makeRunner() as never,
      prisma as never,
      notifications as never,
      makeLogger(),
    );

    await job.handle();

    // u2 was already notified and must be skipped entirely
    expect(notifications.sendPush).toHaveBeenCalledTimes(2);
    expect(notifications.sendPush).not.toHaveBeenCalledWith(
      'u2',
      expect.anything(),
    );
    // u1 push succeeded → log; u3 push failed → no log
    expect(notifications.logNotification).toHaveBeenCalledTimes(1);
    expect(notifications.logNotification).toHaveBeenCalledWith(
      'u1',
      NotificationType.EVENTS,
      { eventId: 'evt1' },
    );
  });
});
