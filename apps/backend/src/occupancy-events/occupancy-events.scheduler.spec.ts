import { Test, TestingModule } from '@nestjs/testing';
import { OccupancyEventsScheduler } from './occupancy-events.scheduler';
import { OccupancyEventsService } from './occupancy-events.service';

describe('OccupancyEventsScheduler', () => {
  let scheduler: OccupancyEventsScheduler;
  let occupancyEventsService: jest.Mocked<OccupancyEventsService>;

  const mockSnapshotResult = {
    count: 3,
    timestamp: '2026-02-07T12:00:00.000Z',
  };

  beforeEach(async () => {
    const mockOccupancyEventsService = {
      createSnapshots: jest.fn(),
      cleanupStaleDeviceStates: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OccupancyEventsScheduler,
        { provide: OccupancyEventsService, useValue: mockOccupancyEventsService },
      ],
    }).compile();

    scheduler = module.get<OccupancyEventsScheduler>(OccupancyEventsScheduler);
    occupancyEventsService = module.get(OccupancyEventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleSnapshotCron', () => {
    it('should call createSnapshots and log success', async () => {
      occupancyEventsService.createSnapshots.mockResolvedValue(mockSnapshotResult);
      const logSpy = jest.spyOn(scheduler['logger'], 'log');

      await scheduler.handleSnapshotCron();

      expect(occupancyEventsService.createSnapshots).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        'Successfully created 3 occupancy snapshots for ML training at 2026-02-07T12:00:00.000Z'
      );
    });

    it('should log starting message before creating snapshots', async () => {
      occupancyEventsService.createSnapshots.mockResolvedValue(mockSnapshotResult);
      const logSpy = jest.spyOn(scheduler['logger'], 'log');

      await scheduler.handleSnapshotCron();

      expect(logSpy).toHaveBeenNthCalledWith(1, 'Starting scheduled occupancy snapshot generation...');
    });

    it('should handle createSnapshots error gracefully', async () => {
      occupancyEventsService.createSnapshots.mockRejectedValue(
        new Error('Database unavailable')
      );

      await expect(scheduler.handleSnapshotCron()).resolves.not.toThrow();
    });

    it('should log error when snapshot creation fails', async () => {
      const errorSpy = jest.spyOn(scheduler['logger'], 'error');
      occupancyEventsService.createSnapshots.mockRejectedValue(
        new Error('Database unavailable')
      );

      await scheduler.handleSnapshotCron();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to create occupancy snapshots: Database unavailable',
        expect.any(String)
      );
    });

    it('should handle zero snapshots created', async () => {
      occupancyEventsService.createSnapshots.mockResolvedValue({
        count: 0,
        timestamp: '2026-02-07T12:00:00.000Z',
      });
      const logSpy = jest.spyOn(scheduler['logger'], 'log');

      await scheduler.handleSnapshotCron();

      expect(logSpy).toHaveBeenCalledWith(
        'Successfully created 0 occupancy snapshots for ML training at 2026-02-07T12:00:00.000Z'
      );
    });

    it('should handle non-Error thrown objects', async () => {
      const errorSpy = jest.spyOn(scheduler['logger'], 'error');
      occupancyEventsService.createSnapshots.mockRejectedValue('string error');

      await scheduler.handleSnapshotCron();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to create occupancy snapshots: Unknown error',
        undefined
      );
    });
  });

  describe('handleStaleCleanupCron', () => {
    it('should call cleanupStaleDeviceStates with 18 hours and log success', async () => {
      occupancyEventsService.cleanupStaleDeviceStates.mockResolvedValue({ cleaned: 5 });
      const logSpy = jest.spyOn(scheduler['logger'], 'log');

      await scheduler.handleStaleCleanupCron();

      expect(occupancyEventsService.cleanupStaleDeviceStates).toHaveBeenCalledWith(18);
      expect(logSpy).toHaveBeenCalledWith('Stale cleanup complete: 5 stale ENTER records cleaned');
    });

    it('should log starting message before cleanup', async () => {
      occupancyEventsService.cleanupStaleDeviceStates.mockResolvedValue({ cleaned: 0 });
      const logSpy = jest.spyOn(scheduler['logger'], 'log');

      await scheduler.handleStaleCleanupCron();

      expect(logSpy).toHaveBeenNthCalledWith(1, 'Starting stale device state cleanup...');
    });

    it('should handle cleanup error gracefully', async () => {
      occupancyEventsService.cleanupStaleDeviceStates.mockRejectedValue(
        new Error('Database unavailable')
      );

      await expect(scheduler.handleStaleCleanupCron()).resolves.not.toThrow();
    });

    it('should log error when cleanup fails', async () => {
      const errorSpy = jest.spyOn(scheduler['logger'], 'error');
      occupancyEventsService.cleanupStaleDeviceStates.mockRejectedValue(
        new Error('Database unavailable')
      );

      await scheduler.handleStaleCleanupCron();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to clean up stale device states: Database unavailable',
        expect.any(String)
      );
    });
  });
});
