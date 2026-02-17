import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../database/database.module';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    userFavorite: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
    lot: { findFirst: jest.Mock };
    school: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      userFavorite: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
      lot: { findFirst: jest.fn() },
      school: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid@csulb.edu')).rejects.toThrow(NotFoundException);
    });

    it('should return user with favorites when found', async () => {
      const mockUser = {
        id: 'user-uuid',
        email: 'test@csulb.edu',
        first_name: 'Test',
        last_name: 'User',
        user_type: 'STUDENT',
        phone: null,
        notification_preferences: {},
        created_at: new Date(),
        last_login: new Date(),
        favorites: [
          { lot_id: 'lot-uuid-1', added_at: new Date() },
        ],
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findOne('test@csulb.edu');

      expect(result).toBeDefined();
      expect(result.email).toBe('test@csulb.edu');
      expect(result.favorites).toEqual(['lot-uuid-1']);
    });
  });

  describe('getFavorites', () => {
    it('should return array of user favorites', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid', email: 'test@csulb.edu' });
      prisma.userFavorite.findMany.mockResolvedValue([
        { lot_id: 'lot-uuid', lot: { lot_id: 'G1' }, added_at: new Date() },
      ]);

      const result = await service.getFavorites('test@csulb.edu');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].lot_id).toBe('G1');
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getFavorites('invalid@csulb.edu')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addFavorite', () => {
    it('should add favorite via upsert', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid', email: 'test@csulb.edu' });
      prisma.lot.findFirst.mockResolvedValue({ id: 'lot-uuid', lot_id: 'G1' });
      prisma.userFavorite.upsert.mockResolvedValue({});

      await service.addFavorite('test@csulb.edu', 'G1');

      expect(prisma.userFavorite.upsert).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.addFavorite('invalid@csulb.edu', 'G1'))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if lot does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid', email: 'test@csulb.edu' });
      prisma.lot.findFirst.mockResolvedValue(null);

      await expect(service.addFavorite('test@csulb.edu', 'INVALID'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('removeFavorite', () => {
    it('should remove favorite via deleteMany', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid', email: 'test@csulb.edu' });
      prisma.lot.findFirst.mockResolvedValue({ id: 'lot-uuid', lot_id: 'G1' });
      prisma.userFavorite.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeFavorite('test@csulb.edu', 'G1');

      expect(prisma.userFavorite.deleteMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.removeFavorite('invalid@csulb.edu', 'G1'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('updateNotificationPreferences', () => {
    it('should update notification preferences', async () => {
      const mockUser = {
        id: 'user-uuid',
        email: 'test@csulb.edu',
        first_name: 'Test',
        last_name: 'User',
        user_type: 'STUDENT',
        phone: null,
        notification_preferences: { favorites_filling: true, surge_alerts: false },
        created_at: new Date(),
        last_login: new Date(),
        favorites: [],
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const prefs = { favorites_filling: true, surge_alerts: false };
      const result = await service.updateNotificationPreferences('test@csulb.edu', prefs);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { email: 'test@csulb.edu' },
        data: { notification_preferences: prefs },
      });
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.updateNotificationPreferences('invalid@csulb.edu', {}))
        .rejects.toThrow(NotFoundException);
    });
  });
});
