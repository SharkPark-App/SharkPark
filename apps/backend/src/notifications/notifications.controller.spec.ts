import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DebugPushType, DebugSendPushDto } from './dto/debug-send-push.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { UnregisterPushTokenDto } from './dto/unregister-push-token.dto';

const mockNotificationsService = {
  registerPushTokenByEmail: jest.fn(),
  unregisterPushTokenByEmail: jest.fn(),
  debugPushTestByEmail: jest.fn(),
};

describe('NotificationsController', () => {
  let controller: NotificationsController;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDebugPushFlag = process.env.ENABLE_DEBUG_PUSH_TEST;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: mockNotificationsService }],
    }).compile();

    controller = module.get(NotificationsController);
  });

  afterEach(() => jest.clearAllMocks());

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ENABLE_DEBUG_PUSH_TEST = originalDebugPushFlag;
  });

  describe('POST me/push-token', () => {
    const dto: RegisterPushTokenDto = { token: 'fcm-abc123', platform: 'ios' };

    it('delegates to registerPushTokenByEmail with the authenticated email', async () => {
      mockNotificationsService.registerPushTokenByEmail.mockResolvedValue(undefined);
      const req = { user: { email: 'student@csulb.edu' } } as any;

      await controller.registerPushToken(req, dto);

      expect(mockNotificationsService.registerPushTokenByEmail).toHaveBeenCalledWith(
        'student@csulb.edu',
        'fcm-abc123',
        'ios',
      );
    });

    it('throws UnauthorizedException when the request carries no email', async () => {
      const req = { user: {} } as any;

      await expect(controller.registerPushToken(req, dto)).rejects.toThrow(UnauthorizedException);
      expect(mockNotificationsService.registerPushTokenByEmail).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when there is no user object at all', async () => {
      const req = {} as any;

      await expect(controller.registerPushToken(req, dto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('DELETE me/push-token', () => {
    const dto: UnregisterPushTokenDto = { token: 'fcm-abc123' };

    it('delegates to unregisterPushTokenByEmail with the authenticated email', async () => {
      mockNotificationsService.unregisterPushTokenByEmail.mockResolvedValue(undefined);
      const req = { user: { email: 'student@csulb.edu' } } as any;

      await controller.unregisterPushToken(req, dto);

      expect(mockNotificationsService.unregisterPushTokenByEmail).toHaveBeenCalledWith(
        'student@csulb.edu',
        'fcm-abc123',
      );
    });

    it('throws UnauthorizedException when the request carries no email', async () => {
      const req = { user: {} } as any;

      await expect(controller.unregisterPushToken(req, dto)).rejects.toThrow(UnauthorizedException);
      expect(mockNotificationsService.unregisterPushTokenByEmail).not.toHaveBeenCalled();
    });
  });

  describe('POST me/push-test', () => {
    const dto: DebugSendPushDto = { type: DebugPushType.SURGE, lotId: 'G1' };

    it('throws ForbiddenException in production even when flag is true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_DEBUG_PUSH_TEST = 'true';
      const req = { user: { email: 'student@csulb.edu' } } as any;

      await expect(controller.sendPushTest(req, dto)).rejects.toThrow(ForbiddenException);
      expect(mockNotificationsService.debugPushTestByEmail).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when debug flag is not enabled', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_DEBUG_PUSH_TEST = 'false';
      const req = { user: { email: 'student@csulb.edu' } } as any;

      await expect(controller.sendPushTest(req, dto)).rejects.toThrow(ForbiddenException);
      expect(mockNotificationsService.debugPushTestByEmail).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when debug endpoint is enabled but email is missing', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_DEBUG_PUSH_TEST = 'true';
      const req = { user: {} } as any;

      await expect(controller.sendPushTest(req, dto)).rejects.toThrow(UnauthorizedException);
      expect(mockNotificationsService.debugPushTestByEmail).not.toHaveBeenCalled();
    });

    it('delegates to debugPushTestByEmail when endpoint is enabled and email is present', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ENABLE_DEBUG_PUSH_TEST = 'true';
      const req = { user: { email: 'student@csulb.edu' } } as any;
      mockNotificationsService.debugPushTestByEmail.mockResolvedValue({
        sent: true,
        pushConfigured: true,
        tokenCount: 1,
      });

      const result = await controller.sendPushTest(req, dto);

      expect(mockNotificationsService.debugPushTestByEmail).toHaveBeenCalledWith('student@csulb.edu', dto);
      expect(result).toEqual({ sent: true, pushConfigured: true, tokenCount: 1 });
    });
  });
});
