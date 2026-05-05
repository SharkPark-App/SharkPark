import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
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
  let config: { get: jest.Mock };
  let prisma: {
    pushToken: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    notificationLog: {
      count: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    user: {
      findUniqueOrThrow: jest.Mock;
    };
  };

  beforeEach(async () => {
    // Reset Firebase state between tests
    mockApps.length = 0;
    mockSendEachForMulticast.mockReset();

    config = { get: jest.fn().mockReturnValue('') };

    prisma = {
      pushToken: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      notificationLog: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findUniqueOrThrow: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── onModuleInit ──────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('skips initializeApp when Firebase is already initialized', () => {
      mockApps.push({});

      service.onModuleInit();

      expect(admin.initializeApp).not.toHaveBeenCalled();
    });

    it('calls initializeApp when all credentials are present', () => {
      config.get.mockImplementation((key: string) => ({
        'notifications.firebaseProjectId': 'sharkpark-test',
        'notifications.firebaseClientEmail': 'sa@sharkpark-test.iam.gserviceaccount.com',
        'notifications.firebasePrivateKey': '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
      }[key] ?? ''));

      service.onModuleInit();

      expect(admin.initializeApp).toHaveBeenCalledTimes(1);
    });

    it('does not throw and skips initializeApp when credentials are missing', () => {
      // config.get returns '' for all keys by default

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
        responses: [
          { success: true },
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        ],
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
        responses: [
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
          { success: false, error: { code: 'messaging/invalid-registration-token' } },
        ],
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

      const result = await service.hasRecentLog('user-cuid', NotificationType.SURGE, 2 * 60 * 60 * 1000);

      expect(result).toBe(false);
    });

    it('returns true when a matching log exists within the window', async () => {
      prisma.notificationLog.count.mockResolvedValue(1);

      const result = await service.hasRecentLog('user-cuid', NotificationType.SURGE, 2 * 60 * 60 * 1000);

      expect(result).toBe(true);
    });

    it('includes lot_id filter when lotId context is provided', async () => {
      prisma.notificationLog.count.mockResolvedValue(0);

      await service.hasRecentLog('user-cuid', NotificationType.FAVORITES_FILLING, 4 * 60 * 60 * 1000, { lotId: 'lot-cuid' });

      expect(prisma.notificationLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lot_id: 'lot-cuid' }),
        }),
      );
    });

    it('includes event_id filter when eventId context is provided', async () => {
      prisma.notificationLog.count.mockResolvedValue(0);

      await service.hasRecentLog('user-cuid', NotificationType.EVENTS, 3 * 60 * 60 * 1000, { eventId: 'event-cuid' });

      expect(prisma.notificationLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ event_id: 'event-cuid' }),
        }),
      );
    });

    it('omits lot_id and event_id filters when no context is provided', async () => {
      prisma.notificationLog.count.mockResolvedValue(0);

      await service.hasRecentLog('user-cuid', NotificationType.SURGE, 2 * 60 * 60 * 1000);

      const callArg = prisma.notificationLog.count.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('lot_id');
      expect(callArg.where).not.toHaveProperty('event_id');
    });
  });

  // ─── recentlyNotifiedUsers ─────────────────────────────────────────────

  describe('recentlyNotifiedUsers', () => {
    it('returns an empty Set without querying when userIds is empty', async () => {
      const result = await service.recentlyNotifiedUsers([], NotificationType.SURGE, 2 * 60 * 60 * 1000);

      expect(result).toEqual(new Set());
      expect(prisma.notificationLog.findMany).not.toHaveBeenCalled();
    });

    it('returns a Set containing only user IDs that have a recent log', async () => {
      prisma.notificationLog.findMany.mockResolvedValue([
        { user_id: 'user-a' },
        { user_id: 'user-b' },
      ]);

      const result = await service.recentlyNotifiedUsers(
        ['user-a', 'user-b', 'user-c'],
        NotificationType.FAVORITES_FILLING,
        4 * 60 * 60 * 1000,
        { lotId: 'lot-cuid' },
      );

      expect(result).toEqual(new Set(['user-a', 'user-b']));
      expect(result.has('user-c')).toBe(false);
    });

    it('passes lot_id filter for lotId context', async () => {
      prisma.notificationLog.findMany.mockResolvedValue([]);

      await service.recentlyNotifiedUsers(['user-a'], NotificationType.FAVORITES_FILLING, 4 * 60 * 60 * 1000, { lotId: 'lot-cuid' });

      expect(prisma.notificationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lot_id: 'lot-cuid' }),
        }),
      );
    });

    it('passes event_id filter for eventId context', async () => {
      prisma.notificationLog.findMany.mockResolvedValue([]);

      await service.recentlyNotifiedUsers(['user-a'], NotificationType.EVENTS, 3 * 60 * 60 * 1000, { eventId: 'event-cuid' });

      expect(prisma.notificationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ event_id: 'event-cuid' }),
        }),
      );
    });

    it('omits lot_id and event_id filters when no context is provided', async () => {
      prisma.notificationLog.findMany.mockResolvedValue([]);

      await service.recentlyNotifiedUsers(['user-a'], NotificationType.SURGE, 2 * 60 * 60 * 1000);

      const callArg = prisma.notificationLog.findMany.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('lot_id');
      expect(callArg.where).not.toHaveProperty('event_id');
    });
  });

  // ─── logNotification ───────────────────────────────────────────────────

  describe('logNotification', () => {
    it('creates a log row with lot_id set for lot context', async () => {
      await service.logNotification('user-cuid', NotificationType.FAVORITES_FILLING, { lotId: 'lot-cuid' });

      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: { user_id: 'user-cuid', type: NotificationType.FAVORITES_FILLING, lot_id: 'lot-cuid', event_id: null },
      });
    });

    it('creates a log row with event_id set for event context', async () => {
      await service.logNotification('user-cuid', NotificationType.EVENTS, { eventId: 'event-cuid' });

      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: { user_id: 'user-cuid', type: NotificationType.EVENTS, lot_id: null, event_id: 'event-cuid' },
      });
    });

    it('creates a log row with both context fields null when no context is provided', async () => {
      await service.logNotification('user-cuid', NotificationType.SURGE);

      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: { user_id: 'user-cuid', type: NotificationType.SURGE, lot_id: null, event_id: null },
      });
    });
  });

  describe('pruneOldLogs', () => {
    it('deletes notification log rows older than the cutoff', async () => {
      prisma.notificationLog.deleteMany.mockResolvedValue({ count: 42 });

      const result = await service.pruneOldLogs(90);

      expect(prisma.notificationLog.deleteMany).toHaveBeenCalledTimes(1);
      const call = prisma.notificationLog.deleteMany.mock.calls[0][0];
      expect(call.where.sent_at.lt).toBeInstanceOf(Date);
      expect(result.logs_deleted).toBe(42);
      expect(result.cutoff).toMatch(/T/);
    });

    it('throws on retentionDays < 1', async () => {
      await expect(service.pruneOldLogs(0)).rejects.toThrow(
        'pruneOldLogs: retentionDays must be >= 1',
      );
    });
  });
});
