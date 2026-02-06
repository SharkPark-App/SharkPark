import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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

      const result = await controller.getUser('test@csulb.edu');

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

      const result = await controller.getFavorites('test@csulb.edu');

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

      const result = await controller.addFavorite('test@csulb.edu', 'G1');

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

      const result = await controller.removeFavorite('test@csulb.edu', 'G1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('G1');
      expect(service.removeFavorite).toHaveBeenCalledWith('test@csulb.edu', 'G1');
    });
  });
});
