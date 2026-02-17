import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './database/database.module';
import { SERVICE_NAME } from './constants';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]) } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('should return health check with ok status and service name', async () => {
    const result = await appController.health();
    expect(result.ok).toBe(true);
    expect(result.service).toBe(SERVICE_NAME);
    expect(result.database).toBe('connected');
  });
});
