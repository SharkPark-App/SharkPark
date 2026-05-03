jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn(),
}));

import { runCronJob } from './_bootstrap';
import './notify-surge';

type WorkFn = (ctx: { app: unknown; prisma: unknown; logger: unknown }) => Promise<void>;

function makeCtx() {
  const svc = {
    recentlyNotifiedUsers: jest.fn().mockResolvedValue(new Set<string>()),
    sendPush: jest.fn().mockResolvedValue(true),
    logNotification: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    occupancySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const app = { get: jest.fn().mockReturnValue(svc) };
  return { app, prisma, logger, svc };
}

describe('notify-surge', () => {
  let work: WorkFn;

  beforeAll(() => {
    work = (runCronJob as jest.Mock).mock.calls[0][2];
  });

  it('early-returns when no lots are above 90%', async () => {
    const { app, prisma, logger, svc } = makeCtx();

    await work({ app, prisma, logger });

    expect(svc.sendPush).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('no lots above 90%'));
  });

  it('deduplicates school IDs when multiple lots from the same school are surging', async () => {
    const { app, prisma, logger, svc } = makeCtx();
    prisma.occupancySnapshot.findMany.mockResolvedValue([
      { lot: { school_id: 'school-a' } },
      { lot: { school_id: 'school-a' } },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);

    await work({ app, prisma, logger });

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(svc.sendPush).toHaveBeenCalledTimes(1);
  });
});
