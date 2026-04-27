import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: jest.Mock };

  beforeEach(async () => {
    healthCheckService = {
      check: jest.fn().mockResolvedValue({
        status: 'ok',
        details: {
          database: { status: 'up' },
          memory_heap: { status: 'up' },
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: MemoryHealthIndicator, useValue: { checkHeap: jest.fn() } },
        { provide: PrismaHealthIndicator, useValue: { isHealthy: jest.fn() } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return health check result', async () => {
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(healthCheckService.check).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Function), expect.any(Function)]),
    );
  });

  it('live() returns ok without calling any health indicator', () => {
    const result = controller.live();
    expect(result).toEqual({ status: 'ok' });
    expect(healthCheckService.check).not.toHaveBeenCalled();
  });

  it('ready() runs the database + memory checks', async () => {
    const result = await controller.ready();
    expect(result.status).toBe('ok');
    expect(healthCheckService.check).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Function), expect.any(Function)]),
    );
  });
});
