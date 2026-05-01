import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

const mockNotificationsService = {
  registerPushTokenByEmail: jest.fn(),
};

describe('NotificationsController', () => {
  let controller: NotificationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: mockNotificationsService }],
    }).compile();

    controller = module.get(NotificationsController);
  });

  afterEach(() => jest.clearAllMocks());

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

    it('throws ForbiddenException when the request carries no email', async () => {
      const req = { user: {} } as any;

      await expect(controller.registerPushToken(req, dto)).rejects.toThrow(ForbiddenException);
      expect(mockNotificationsService.registerPushTokenByEmail).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when there is no user object at all', async () => {
      const req = {} as any;

      await expect(controller.registerPushToken(req, dto)).rejects.toThrow(ForbiddenException);
    });
  });
});
