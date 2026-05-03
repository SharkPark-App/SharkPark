import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../database/database.module';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
    userFavorite: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
    lot: { findFirst: jest.Mock };
    school: { findFirst: jest.Mock };
    auditEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      userFavorite: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
      lot: { findFirst: jest.fn() },
      school: { findFirst: jest.fn() },
      auditEvent: { create: jest.fn() },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
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

    it('should propagate error when update fails', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid', email: 'test@csulb.edu' });
      prisma.user.update.mockRejectedValue(new Error('DB write error'));

      await expect(service.updateNotificationPreferences('test@csulb.edu', { surge_alerts: true }))
        .rejects.toThrow('DB write error');
    });
  });

  describe('findOrCreateUser', () => {
    const existingUser = {
      id: 'user-uuid',
      email: 'existing@student.csulb.edu',
      first_name: 'Existing',
      last_name: 'User',
      user_type: 'STUDENT',
      phone: null,
      notification_preferences: { favorites_filling: true },
      created_at: new Date('2025-01-01'),
      last_login: new Date('2025-06-01'),
      favorites: [{ lot_id: 'lot-uuid-1' }, { lot_id: 'lot-uuid-2' }],
    };

    it('should return existing user and update last_login', async () => {
      prisma.user.findUnique.mockResolvedValue(existingUser);
      prisma.user.update.mockResolvedValue(existingUser);

      const result = await service.findOrCreateUser(
        'existing@student.csulb.edu',
        'Existing',
        'User',
      );

      expect(result.email).toBe('existing@student.csulb.edu');
      expect(result.favorites).toEqual(['lot-uuid-1', 'lot-uuid-2']);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { email: 'existing@student.csulb.edu' },
        data: { last_login: expect.any(Date) },
      });
      // Should NOT create a new user
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should create a STUDENT user when email ends with @student.csulb.edu', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.school.findFirst.mockResolvedValue({ id: 'school-uuid', short_name: 'CSULB' });

      const newUser = {
        id: 'new-uuid',
        email: 'new@student.csulb.edu',
        first_name: 'New',
        last_name: 'Student',
        user_type: 'STUDENT',
        phone: null,
        notification_preferences: {
          favorites_filling: false,
          favorites_clearing: false,
          surge_alerts: false,
          event_alerts: false,
        },
        created_at: new Date(),
        last_login: new Date(),
      };
      prisma.user.create.mockResolvedValue(newUser);

      const result = await service.findOrCreateUser(
        'new@student.csulb.edu',
        'New',
        'Student',
      );

      expect(result.email).toBe('new@student.csulb.edu');
      expect(result.user_type).toBe('STUDENT');
      expect(result.favorites).toEqual([]);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          school_id: 'school-uuid',
          email: 'new@student.csulb.edu',
          user_type: 'STUDENT',
        }),
      });
    });

    it('should create an EMPLOYEE user when email does not end with @student.csulb.edu', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.school.findFirst.mockResolvedValue({ id: 'school-uuid', short_name: 'CSULB' });

      const newUser = {
        id: 'new-uuid',
        email: 'prof@csulb.edu',
        first_name: 'Prof',
        last_name: 'Smith',
        user_type: 'EMPLOYEE',
        phone: null,
        notification_preferences: {},
        created_at: new Date(),
        last_login: new Date(),
      };
      prisma.user.create.mockResolvedValue(newUser);

      const result = await service.findOrCreateUser('prof@csulb.edu', 'Prof', 'Smith');

      expect(result.user_type).toBe('EMPLOYEE');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_type: 'EMPLOYEE',
        }),
      });
    });

    it('should classify lookalike subdomains as EMPLOYEE (not STUDENT)', async () => {
      // Guards against the prior `email.includes('@student')` bug, which would
      // mis-classify e.g. @student-affairs.csulb.edu or @student.foo.com.
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.school.findFirst.mockResolvedValue({ id: 'school-uuid', short_name: 'CSULB' });

      const lookalikes = [
        'admin@student-affairs.csulb.edu',
        'attacker@student.foo.com',
        'bob@studentaffairs.csulb.edu',
      ];

      for (const email of lookalikes) {
        prisma.user.create.mockResolvedValueOnce({
          id: 'uuid',
          email,
          first_name: 'X',
          last_name: 'Y',
          user_type: 'EMPLOYEE',
          phone: null,
          notification_preferences: {},
          created_at: new Date(),
          last_login: new Date(),
        });
        const result = await service.findOrCreateUser(email, 'X', 'Y');
        expect(result.user_type).toBe('EMPLOYEE');
      }
    });

    it('should throw when default school (CSULB) is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.school.findFirst.mockResolvedValue(null);

      await expect(
        service.findOrCreateUser('new@student.csulb.edu', 'New', 'Student'),
      ).rejects.toThrow('Default school (CSULB) not found');
    });

    it('should propagate error when user creation fails', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.school.findFirst.mockResolvedValue({ id: 'school-uuid', short_name: 'CSULB' });
      prisma.user.create.mockRejectedValue(new Error('Unique constraint violation'));

      await expect(
        service.findOrCreateUser('dup@student.csulb.edu', 'Dup', 'User'),
      ).rejects.toThrow('Unique constraint violation');
    });
  });

  describe('error paths', () => {
    it('findOne should propagate non-404 errors', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('Connection refused'));

      await expect(service.findOne('test@csulb.edu')).rejects.toThrow('Connection refused');
    });

    it('addFavorite should propagate upsert errors', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid', email: 'test@csulb.edu' });
      prisma.lot.findFirst.mockResolvedValue({ id: 'lot-uuid', lot_id: 'G1' });
      prisma.userFavorite.upsert.mockRejectedValue(new Error('DB constraint error'));

      await expect(service.addFavorite('test@csulb.edu', 'G1'))
        .rejects.toThrow('DB constraint error');
    });

    it('removeFavorite should throw NotFoundException if lot does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid', email: 'test@csulb.edu' });
      prisma.lot.findFirst.mockResolvedValue(null);

      await expect(service.removeFavorite('test@csulb.edu', 'INVALID'))
        .rejects.toThrow(NotFoundException);
    });

    it('removeFavorite should propagate deleteMany errors', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-uuid', email: 'test@csulb.edu' });
      prisma.lot.findFirst.mockResolvedValue({ id: 'lot-uuid', lot_id: 'G1' });
      prisma.userFavorite.deleteMany.mockRejectedValue(new Error('DB delete error'));

      await expect(service.removeFavorite('test@csulb.edu', 'G1'))
        .rejects.toThrow('DB delete error');
    });
  });

  describe('exportUserData', () => {
    const baseUser = {
      id: 'user-uuid',
      email: 'test@csulb.edu',
      first_name: 'Test',
      last_name: 'User',
      user_type: 'STUDENT',
      phone: null,
      notification_preferences: { favorites_filling: false },
      created_at: new Date('2025-01-01'),
      last_login: new Date('2026-01-01'),
      favorites: [
        { lot: { lot_id: 'G1' }, added_at: new Date('2026-01-10') },
      ],
      push_tokens: [
        { token: 'ExponentPushToken[abc]', platform: 'ios', created_at: new Date('2026-02-01') },
      ],
      reports: [
        { lot: { lot_id: 'G1' }, type: 'BLOCKAGE', message: null, created_at: new Date('2026-03-01') },
      ],
      notification_logs: [
        { type: 'favorites_filling', lot: { lot_id: 'G1' }, sent_at: new Date('2026-04-01') },
        { type: 'surge', lot: null, sent_at: new Date('2026-04-02') },
      ],
    };

    it('should return all user data and write a USER_DATA_EXPORTED audit row', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);
      prisma.auditEvent.create.mockResolvedValue({});

      const result = await service.exportUserData('test@csulb.edu');

      expect(result.profile.email).toBe('test@csulb.edu');
      expect(result.favorites).toEqual([{ lot_id: 'G1', added_at: baseUser.favorites[0].added_at }]);
      expect(result.push_tokens[0].token).toBe('ExponentPushToken[abc]');
      expect(result.push_tokens[0].registered_at).toEqual(baseUser.push_tokens[0].created_at);
      expect(result.reports[0]).toEqual({
        lot_id: 'G1',
        type: 'BLOCKAGE',
        message: null,
        submitted_at: baseUser.reports[0].created_at,
      });
      expect(result.notification_logs[0].lot_id).toBe('G1');
      expect(result.notification_logs[1].lot_id).toBeNull();
      expect(result.exported_at).toBeInstanceOf(Date);
      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event_type: 'USER_DATA_EXPORTED',
          actor_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      });
    });

    it('should not include raw email in the audit row', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);
      prisma.auditEvent.create.mockResolvedValue({});

      await service.exportUserData('test@csulb.edu');

      const call = prisma.auditEvent.create.mock.calls[0][0];
      expect(JSON.stringify(call)).not.toContain('test@csulb.edu');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.exportUserData('ghost@csulb.edu')).rejects.toThrow(NotFoundException);
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('should throw NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.deleteUser('ghost@csulb.edu')).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should write the audit row and delete the user in one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        email: 'bye@csulb.edu',
        user_type: 'STUDENT',
      });
      prisma.auditEvent.create.mockReturnValue('audit-op');
      prisma.user.delete.mockReturnValue('delete-op');

      await service.deleteUser('bye@csulb.edu');

      expect(prisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event_type: 'USER_DELETED',
          actor_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          metadata: { user_type: 'STUDENT' },
        }),
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { email: 'bye@csulb.edu' } });
      expect(prisma.$transaction).toHaveBeenCalledWith(['audit-op', 'delete-op']);
    });

    it('should not include the raw email in the audit row', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u', email: 'private@csulb.edu', user_type: 'EMPLOYEE',
      });
      prisma.auditEvent.create.mockReturnValue('a');
      prisma.user.delete.mockReturnValue('d');

      await service.deleteUser('private@csulb.edu');

      const call = prisma.auditEvent.create.mock.calls[0][0];
      expect(JSON.stringify(call)).not.toContain('private@csulb.edu');
    });
  });
});
