jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn(),
}));

import { NotificationType } from '@prisma/client';
import { runCronJob } from './_bootstrap';
import './notify-favorites-filling';

type WorkFn = (ctx: { app: unknown; prisma: unknown; logger: unknown }) => Promise<void>;

function makeCtx() {
  const svc = {
    recentlyNotifiedUsers: jest.fn().mockResolvedValue(new Set<string>()),
    sendPush: jest.fn().mockResolvedValue(true),
    logNotification: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    occupancySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    userFavorite: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const app = { get: jest.fn().mockReturnValue(svc) };
  return { app, prisma, logger, svc };
}

describe('notify-favorites-filling', () => {
  let work: WorkFn;

  beforeAll(() => {
    work = (runCronJob as jest.Mock).mock.calls[0][2];
  });

  it('early-returns when no lots are above 80%', async () => {
    const { app, prisma, logger, svc } = makeCtx();

    await work({ app, prisma, logger });

    expect(svc.sendPush).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('no lots above 80%'));
  });

  it('passes the correct lot context to recentlyNotifiedUsers', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    prisma.occupancySnapshot.findMany.mockResolvedValue([
      { lot_id: 'lot-1', lot: { display_name: 'Lot G3' } },
    ]);
    prisma.userFavorite.findMany.mockResolvedValue([{ user_id: 'user-1' }]);

    await work({ app, prisma, logger });

    expect(svc.recentlyNotifiedUsers).toHaveBeenCalledWith(
      ['user-1'],
      NotificationType.FAVORITES_FILLING,
      expect.any(Number),
      { lotId: 'lot-1' },
    );
  });
});
