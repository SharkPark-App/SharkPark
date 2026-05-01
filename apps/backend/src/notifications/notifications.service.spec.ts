import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../database/database.module';
import * as admin from 'firebase-admin';

// mockApps and mockSendEachForMulticast are used inside the jest.mock() factory below
const mockApps: unknown[] = [];
const mockSendEachForMulticast = jest.fn();

jest.mock('firebase-admin', () => ({
  get apps() {
    return mockApps;
  },
  initializeApp: jest.fn(),
  credential: { cert: jest.fn().mockReturnValue({}) },
  messaging: jest.fn(() => ({ sendEachForMulticast: mockSendEachForMulticast })),
}));

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    pushToken: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    notificationLog: {
      count: jest.Mock;
      create: jest.Mock;
    };
    user: {
      findUniqueOrThrow: jest.Mock;
    };
  };

  beforeEach(async () => {
    // Reset Firebase state between tests
    mockApps.length = 0;
    mockSendEachForMulticast.mockReset();

    prisma = {
      pushToken: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      notificationLog: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUniqueOrThrow: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── onModuleInit ──────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      process.env = { ...OLD_ENV };
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('skips initializeApp when Firebase is already initialized', () => {
      mockApps.push({});
      process.env.FIREBASE_PROJECT_ID = 'proj';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@proj.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = 'key';

      service.onModuleInit();

      expect(admin.initializeApp).not.toHaveBeenCalled();
    });

    it('calls initializeApp when all credentials are present', () => {
      process.env.FIREBASE_PROJECT_ID = 'sharkpark-test';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@sharkpark-test.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';

      service.onModuleInit();

      expect(admin.initializeApp).toHaveBeenCalledTimes(1);
    });

    it('does not throw when credentials are missing', () => {
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_PRIVATE_KEY;

      expect(() => service.onModuleInit()).not.toThrow();
      expect(admin.initializeApp).not.toHaveBeenCalled();
    });
  });

  // ─── registerPushToken ─────────────────────────────────────────────────

  describe('registerPushToken', () => {
    it('upserts on token uniqueness so reinstalls do not create duplicates', async () => {
      prisma.pushToken.upsert.mockResolvedValue({});

      await service.registerPushToken('user-cuid', 'fcm-abc123', 'ios');

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith({
        where: { token: 'fcm-abc123' },
        create: { user_id: 'user-cuid', token: 'fcm-abc123', platform: 'ios' },
        update: { user_id: 'user-cuid', platform: 'ios' },
      });
    });
  });

  // ─── registerPushTokenByEmail ──────────────────────────────────────────

  describe('registerPushTokenByEmail', () => {
    it('looks up the user by email then delegates to registerPushToken', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-cuid' });
      prisma.pushToken.upsert.mockResolvedValue({});

      await service.registerPushTokenByEmail('student@csulb.edu', 'fcm-abc123', 'android');

      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { email: 'student@csulb.edu' },
        select: { id: true },
      });
      expect(prisma.pushToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ user_id: 'user-cuid' }) }),
      );
    });
  });

  // ─── sendPush ──────────────────────────────────────────────────────────

  describe('sendPush', () => {
    const payload = { title: 'Lot G3 is filling up', body: 'Over 80% full — park soon.' };

    it('returns false immediately when Firebase is not initialized', async () => {
      // mockApps is empty — Firebase not initialized.
      const result = await service.sendPush('user-cuid', payload);

      expect(result).toBe(false);
      expect(prisma.pushToken.findMany).not.toHaveBeenCalled();
    });

    it('returns false when the user has no registered tokens', async () => {
      mockApps.push({});
      prisma.pushToken.findMany.mockResolvedValue([]);

      const result = await service.sendPush('user-cuid', payload);

      expect(result).toBe(false);
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });

    it('sends to all registered tokens and returns true on full success', async () => {
      mockApps.push({});
      prisma.pushToken.findMany.mockResolvedValue([
        { token: 'token-a' },
        { token: 'token-b' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 2,
        responses: [{ success: true }, { success: true }],
      });

      const result = await service.sendPush('user-cuid', payload);

      expect(result).toBe(true);
      expect(mockSendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: ['token-a', 'token-b'],
          notification: { title: payload.title, body: payload.body },
        }),
      );
      expect(prisma.pushToken.deleteMany).not.toHaveBeenCalled();
    });

    it('removes stale tokens when FCM rejects them', async () => {
      mockApps.push({});
      prisma.pushToken.findMany.mockResolvedValue([
        { token: 'token-valid' },
        { token: 'token-stale' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        responses: [{ success: true }, { success: false }],
      });

      const result = await service.sendPush('user-cuid', payload);

      expect(result).toBe(true);
      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['token-stale'] } },
      });
    });

    it('returns false and removes all tokens when every send fails', async () => {
      mockApps.push({});
      prisma.pushToken.findMany.mockResolvedValue([
        { token: 'token-a' },
        { token: 'token-b' },
      ]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 0,
        responses: [{ success: false }, { success: false }],
      });

      const result = await service.sendPush('user-cuid', payload);

      expect(result).toBe(false);
      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['token-a', 'token-b'] } },
      });
    });

    it('forwards the optional data map to FCM', async () => {
      mockApps.push({});
      prisma.pushToken.findMany.mockResolvedValue([{ token: 'token-a' }]);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        responses: [{ success: true }],
      });

      await service.sendPush('user-cuid', {
        ...payload,
        data: { type: 'favorites_filling', lotId: 'lot-cuid' },
      });

      expect(mockSendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({ data: { type: 'favorites_filling', lotId: 'lot-cuid' } }),
      );
    });
  });

  // ─── hasRecentLog ──────────────────────────────────────────────────────

  describe('hasRecentLog', () => {
    it('returns false when no matching log exists within the window', async () => {
      prisma.notificationLog.count.mockResolvedValue(0);

      const result = await service.hasRecentLog('user-cuid', 'surge', 2 * 60 * 60 * 1000);

      expect(result).toBe(false);
    });

    it('returns true when a matching log exists within the window', async () => {
      prisma.notificationLog.count.mockResolvedValue(1);

      const result = await service.hasRecentLog('user-cuid', 'surge', 2 * 60 * 60 * 1000);

      expect(result).toBe(true);
    });

    it('includes lot_id filter when contextId is provided', async () => {
      prisma.notificationLog.count.mockResolvedValue(0);

      await service.hasRecentLog('user-cuid', 'favorites_filling', 4 * 60 * 60 * 1000, 'lot-cuid');

      expect(prisma.notificationLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lot_id: 'lot-cuid' }),
        }),
      );
    });

    it('omits lot_id filter when no contextId is provided', async () => {
      prisma.notificationLog.count.mockResolvedValue(0);

      await service.hasRecentLog('user-cuid', 'surge', 2 * 60 * 60 * 1000);

      const callArg = prisma.notificationLog.count.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('lot_id');
    });
  });

  // ─── logNotification ───────────────────────────────────────────────────

  describe('logNotification', () => {
    it('creates a log row with lot_id set when contextId is provided', async () => {
      await service.logNotification('user-cuid', 'favorites_filling', 'lot-cuid');

      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: { user_id: 'user-cuid', type: 'favorites_filling', lot_id: 'lot-cuid' },
      });
    });

    it('creates a log row with lot_id null when no contextId is provided', async () => {
      await service.logNotification('user-cuid', 'surge');

      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: { user_id: 'user-cuid', type: 'surge', lot_id: null },
      });
    });
  });
});
