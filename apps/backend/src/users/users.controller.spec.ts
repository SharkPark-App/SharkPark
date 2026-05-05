import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ContributorGuard } from '../auth/contributor.guard';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUsersService = {
    findOne: jest.fn(),
    getFavorites: jest.fn(),
    addFavorite: jest.fn(),
    removeFavorite: jest.fn(),
    updateNotificationPreferences: jest.fn(),
    findOrCreateUser: jest.fn(),
    deleteUser: jest.fn(),
    exportUserData: jest.fn(),
    getForecast: jest.fn(),
  };

  /** Helper: build a fake request with the authenticated user. */
  const reqAs = (email: string) => ({ user: { email } }) as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    })
      .overrideGuard(ContributorGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('IDOR protection', () => {
    it('should reject access to another user\'s profile', async () => {
      await expect(
        controller.getUser(reqAs('attacker@csulb.edu'), 'victim@csulb.edu'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject access to another user\'s favorites', async () => {
      await expect(
        controller.getFavorites(reqAs('attacker@csulb.edu'), 'victim@csulb.edu'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject adding favorite for another user', async () => {
      await expect(
        controller.addFavorite(reqAs('attacker@csulb.edu'), 'victim@csulb.edu', 'G1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject removing favorite for another user', async () => {
      await expect(
        controller.removeFavorite(reqAs('attacker@csulb.edu'), 'victim@csulb.edu', 'G1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject deleting another user\'s account', async () => {
      await expect(
        controller.deleteUser(reqAs('attacker@csulb.edu'), 'victim@csulb.edu'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMyData', () => {
    it('should return exported user data', async () => {
      const mockExport = {
        exported_at: new Date(),
        profile: { email: 'test@csulb.edu', first_name: 'Test', last_name: 'User', user_type: 'STUDENT', phone: null, notification_preferences: {}, created_at: new Date(), last_login: null },
        favorites: [{ lot_id: 'G1', added_at: new Date() }],
        push_tokens: [],
        reports: [],
        notification_logs: [],
      };
      mockUsersService.exportUserData.mockResolvedValue(mockExport);

      const result = await controller.getMyData(reqAs('test@csulb.edu'));

      expect(result).toEqual({ success: true, data: mockExport });
      expect(service.exportUserData).toHaveBeenCalledWith('test@csulb.edu');
    });

    it('should throw ForbiddenException when no authenticated email', async () => {
      await expect(
        controller.getMyData({ user: {} } as never),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteMe', () => {
    it('should delete the authenticated user', async () => {
      mockUsersService.deleteUser.mockResolvedValue(undefined);
      await controller.deleteMe(reqAs('test@csulb.edu'));
      expect(service.deleteUser).toHaveBeenCalledWith('test@csulb.edu');
    });

    it('should reject when no authenticated email is present', async () => {
      await expect(
        controller.deleteMe({ user: {} } as never),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteUser', () => {
    it('should delete own account by userId', async () => {
      mockUsersService.deleteUser.mockResolvedValue(undefined);
      await controller.deleteUser(reqAs('test@csulb.edu'), 'test@csulb.edu');
      expect(service.deleteUser).toHaveBeenCalledWith('test@csulb.edu');
    });
  });

  describe('getUser', () => {
    it('should return user profile', async () => {
      const mockUser = {
        user_id: 'test@csulb.edu',
        first_name: 'Test',
        last_name: 'User',
        user_type: 'STUDENT',
        favorites: ['G1', 'G2'],
      };

      mockUsersService.findOne.mockResolvedValue(mockUser);

      const result = await controller.getUser(reqAs('test@csulb.edu'), 'test@csulb.edu');

      expect(result).toEqual({
        success: true,
        data: mockUser,
      });
      expect(service.findOne).toHaveBeenCalledWith('test@csulb.edu');
    });
  });

  describe('getFavorites', () => {
    it('should return user favorites as array of lot IDs', async () => {
      const mockFavorites = [
        { lot_id: 'G1', user_id: 'test@csulb.edu', added_at: '2025-01-01' },
        { lot_id: 'G2', user_id: 'test@csulb.edu', added_at: '2025-01-02' },
      ];

      mockUsersService.getFavorites.mockResolvedValue(mockFavorites);

      const result = await controller.getFavorites(reqAs('test@csulb.edu'), 'test@csulb.edu');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['G1', 'G2']);
      expect(service.getFavorites).toHaveBeenCalledWith('test@csulb.edu');
    });
  });

  describe('addFavorite', () => {
    it('should add favorite lot', async () => {
      const mockResponse = {
        success: true,
        message: 'Added lot G1 to favorites',
      };

      mockUsersService.addFavorite.mockResolvedValue(mockResponse);

      const result = await controller.addFavorite(reqAs('test@csulb.edu'), 'test@csulb.edu', 'G1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('G1');
      expect(service.addFavorite).toHaveBeenCalledWith('test@csulb.edu', 'G1');
    });
  });

  describe('removeFavorite', () => {
    it('should remove favorite lot', async () => {
      const mockResponse = {
        success: true,
        message: 'Removed lot G1 from favorites',
      };

      mockUsersService.removeFavorite.mockResolvedValue(mockResponse);

      const result = await controller.removeFavorite(reqAs('test@csulb.edu'), 'test@csulb.edu', 'G1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('G1');
      expect(service.removeFavorite).toHaveBeenCalledWith('test@csulb.edu', 'G1');
    });
  });

  describe('getForecast', () => {
    it('should return personalized forecast for authenticated user', async () => {
      const mockForecast = {
        user_id: 'test@csulb.edu',
        generated_at: '2026-05-03T00:00:00.000Z',
        lots: [
          {
            lot_id: 'G1',
            predictions: [
              {
                target_time: '2026-05-03T01:00:00.000Z',
                // predicted_occupancy is a rate in [0, 1] per PR #133
                predicted_occupancy: 0.75,
                confidence_lower: 0.6,
                confidence_upper: 0.9,
                model_version: 'v1',
              },
            ],
          },
        ],
      };

      mockUsersService.getForecast.mockResolvedValue(mockForecast);

      const result = await controller.getForecast(reqAs('test@csulb.edu'));

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockForecast);
      expect(service.getForecast).toHaveBeenCalledWith('test@csulb.edu');
    });

    it('should reject when no authenticated email is present', async () => {
      await expect(
        controller.getForecast({ user: {} } as never),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
