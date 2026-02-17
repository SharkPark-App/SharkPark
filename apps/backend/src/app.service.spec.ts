import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { PrismaService } from './database/database.module';
import { SERVICE_NAME } from './constants';

describe('AppService', () => {
  let service: AppService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return ok true when database is reachable', async () => {
      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);
      const result = await service.getHealth();

      expect(result.ok).toBe(true);
      expect(result.service).toBe(SERVICE_NAME);
      expect(result.database).toBe('connected');
      expect(result.timestamp).toBeDefined();
    });

    it('should return ok false when database is unreachable', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      const result = await service.getHealth();

      expect(result.ok).toBe(false);
      expect(result.database).toBe('unreachable');
    });
  });
});
