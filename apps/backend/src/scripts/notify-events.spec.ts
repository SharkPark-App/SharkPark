jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn(),
}));

import { NotificationType } from '@prisma/client';
import { runCronJob } from './_bootstrap';
import './notify-events';

type WorkFn = (ctx: { app: unknown; prisma: unknown; logger: unknown }) => Promise<void>;

function makeCtx() {
  const svc = {
    recentlyNotifiedUsers: jest.fn().mockResolvedValue(new Set<string>()),
    sendPush: jest.fn().mockResolvedValue(true),
    logNotification: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    campusEvent: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const app = { get: jest.fn().mockReturnValue(svc) };
  return { app, prisma, logger, svc };
}

describe('notify-events', () => {
  let work: WorkFn;

  beforeAll(() => {
    work = (runCronJob as jest.Mock).mock.calls[0][1];
  });

  it('early-returns when no events are in the 2-hour window', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    prisma.campusEvent.findMany.mockResolvedValue([]);

    await work({ app, prisma, logger });

    expect(svc.sendPush).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('no upcoming events'));
  });

  it('sends to opted-in users for upcoming events', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    prisma.campusEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        school_id: 'school-a',
        event_name: 'Commencement',
        start_time: new Date('2026-05-01T20:00:00Z'),
        school: { timezone: 'America/Los_Angeles' },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);

    await work({ app, prisma, logger });

    expect(svc.sendPush).toHaveBeenCalledTimes(2);
    expect(svc.sendPush).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ title: 'Commencement starts soon' }),
    );
    expect(svc.logNotification).toHaveBeenCalledWith(
      'user-1',
      NotificationType.EVENTS,
      { eventId: 'event-1' },
    );
  });

  it('formats the start time in the school timezone', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    // 6 PM UTC = 2 PM EDT (America/New_York, UTC-4) vs 11 AM PDT (America/Los_Angeles, UTC-7)
    prisma.campusEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        school_id: 'school-a',
        event_name: 'Game Day',
        start_time: new Date('2026-05-01T18:00:00Z'),
        school: { timezone: 'America/New_York' },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);

    await work({ app, prisma, logger });

    const [, payload] = (svc.sendPush as jest.Mock).mock.calls[0];
    expect(payload.body).toContain('02:00 PM'); // EDT
    expect(payload.body).not.toContain('11:00 AM'); // PDT — would be wrong
  });

  it('passes the correct event context to recentlyNotifiedUsers', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    prisma.campusEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        school_id: 'school-a',
        event_name: 'Concert',
        start_time: new Date('2026-05-01T20:00:00Z'),
        school: { timezone: 'America/Los_Angeles' },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);

    await work({ app, prisma, logger });

    expect(svc.recentlyNotifiedUsers).toHaveBeenCalledWith(
      ['user-1'],
      NotificationType.EVENTS,
      expect.any(Number),
      { eventId: 'event-1' },
    );
  });

  it('skips users already within the dedup window', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    prisma.campusEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        school_id: 'school-a',
        event_name: 'Concert',
        start_time: new Date('2026-05-01T20:00:00Z'),
        school: { timezone: 'America/Los_Angeles' },
      },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);
    svc.recentlyNotifiedUsers.mockResolvedValue(new Set(['user-1']));

    await work({ app, prisma, logger });

    expect(svc.sendPush).not.toHaveBeenCalled();
  });
});
