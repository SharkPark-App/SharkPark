jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn(),
}));

import { NotificationType } from '@prisma/client';
import { runCronJob } from './_bootstrap';
import './notify-favorites-clearing';

type WorkFn = (ctx: { app: unknown; prisma: unknown; logger: unknown }) => Promise<void>;

function makeCtx() {
  const svc = {
    recentlyNotifiedUsers: jest.fn().mockResolvedValue(new Set<string>()),
    sendPush: jest.fn().mockResolvedValue(true),
    logNotification: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    occupancySnapshot: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    userFavorite: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const app = { get: jest.fn().mockReturnValue(svc) };
  return { app, prisma, logger, svc };
}

describe('notify-favorites-clearing', () => {
  let work: WorkFn;

  beforeAll(() => {
    work = (runCronJob as jest.Mock).mock.calls[0][1];
  });

  it('early-returns when no lots are below 30%', async () => {
    const { app, prisma, logger, svc } = makeCtx();

    await work({ app, prisma, logger });

    expect(svc.sendPush).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('no lots below 30%'));
  });

  it('skips a low lot that was never above 75% in the history window', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    prisma.occupancySnapshot.findMany.mockResolvedValue([
      { lot_id: 'lot-1', lot: { display_name: 'Lot A1' } },
    ]);
    prisma.occupancySnapshot.count.mockResolvedValue(0);

    await work({ app, prisma, logger });

    expect(svc.sendPush).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('no lots transitioning from high to low'),
    );
  });

  it('sends to opted-in favorites when a lot transitions from high to low', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    prisma.occupancySnapshot.findMany.mockResolvedValue([
      { lot_id: 'lot-1', lot: { display_name: 'Lot A1' } },
    ]);
    prisma.occupancySnapshot.count.mockResolvedValue(1);
    prisma.userFavorite.findMany.mockResolvedValue([{ user_id: 'user-1' }]);

    await work({ app, prisma, logger });

    expect(svc.logNotification).toHaveBeenCalledWith(
      'user-1',
      NotificationType.FAVORITES_CLEARING,
      { lotId: 'lot-1' },
    );
  });

  it('only queries favorites of lots that were previously high, not all low lots', async () => {
    const { app, prisma, logger } = makeCtx();
    prisma.occupancySnapshot.findMany.mockResolvedValue([
      { lot_id: 'lot-clearing', lot: { display_name: 'Lot A1' } },
      { lot_id: 'lot-always-low', lot: { display_name: 'Lot B2' } },
    ]);
    prisma.occupancySnapshot.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    prisma.userFavorite.findMany.mockResolvedValue([{ user_id: 'user-1' }]);

    await work({ app, prisma, logger });

    expect(prisma.userFavorite.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userFavorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ lot_id: 'lot-clearing' }) }),
    );
  });
});
