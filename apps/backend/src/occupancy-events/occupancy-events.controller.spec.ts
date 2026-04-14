import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OccupancyEventsController } from './occupancy-events.controller';
import { OccupancyEventsService } from './occupancy-events.service';

describe('OccupancyEventsController', () => {
  let controller: OccupancyEventsController;
  let service: jest.Mocked<OccupancyEventsService>;

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      findByLot: jest.fn(),
      getEventStats: jest.fn(),
      createSnapshots: jest.fn(),
      getSnapshots: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OccupancyEventsController],
      providers: [
        { provide: OccupancyEventsService, useValue: mockService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
      ],
    }).compile();

    controller = module.get<OccupancyEventsController>(OccupancyEventsController);
    service = module.get(OccupancyEventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createEvent', () => {
    const validDto = {
      lot_id: 'G1',
      event_type: 'ENTER' as const,
      device_id: 'test-device-123',
      timestamp: '2026-02-07T14:30:00.000Z',
    };

    it('should create an event successfully', async () => {
      service.create.mockResolvedValue({
        event_id: '123',
        lot_id: 'G1',
        event_type: 'ENTER',
        recorded_at: '2026-02-07T14:30:01.000Z',
        deduplicated: false,
      });

      const result = await controller.createEvent(validDto);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Occupancy event recorded successfully');
      expect(result.data.lot_id).toBe('G1');
      expect(service.create).toHaveBeenCalledWith(validDto);
    });

    it('should return appropriate message for deduplicated events', async () => {
      service.create.mockResolvedValue({
        event_id: '123',
        lot_id: 'G1',
        event_type: 'ENTER',
        recorded_at: '2026-02-07T14:30:01.000Z',
        deduplicated: true,
      });

      const result = await controller.createEvent(validDto);

      expect(result.message).toBe('Duplicate event ignored');
      expect(result.data.deduplicated).toBe(true);
    });
  });

  describe('getEventsByLot', () => {
    it('should return events for a lot', async () => {
      const mockEvents = [
        { lot_id: 'G1', event_type: 'ENTER', timestamp: '2026-02-07T10:00:00Z' },
        { lot_id: 'G1', event_type: 'EXIT', timestamp: '2026-02-07T12:00:00Z' },
      ];

      service.findByLot.mockResolvedValue(mockEvents as never);

      const result = await controller.getEventsByLot('g1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(result.success).toBe(true);
      expect(result.lot_id).toBe('G1');
      expect(result.count).toBe(2);
      expect(service.findByLot).toHaveBeenCalledWith('G1', '2026-02-07', '2026-02-07T23:59:59Z', 1000);
    });

    it('should use default dates when not provided', async () => {
      service.findByLot.mockResolvedValue([]);

      await controller.getEventsByLot('G1');

      expect(service.findByLot).toHaveBeenCalled();
      const [, startDate] = service.findByLot.mock.calls[0];
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should throw BadRequestException for invalid start date', async () => {
      await expect(
        controller.getEventsByLot('G1', 'invalid-date')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid end date', async () => {
      await expect(
        controller.getEventsByLot('G1', '2026-02-07', 'invalid-date')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getEventStats', () => {
    it('should return event statistics', async () => {
      service.getEventStats.mockResolvedValue({
        lot_id: 'G1',
        start_date: '2026-02-07',
        end_date: '2026-02-07T23:59:59Z',
        total_enters: 50,
        total_exits: 45,
        net_change: 5,
      });

      const result = await controller.getEventStats('g1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(result.success).toBe(true);
      expect(result.data.total_enters).toBe(50);
      expect(result.data.net_change).toBe(5);
    });

    it('should throw BadRequestException for invalid start date', async () => {
      await expect(
        controller.getEventStats('G1', 'invalid-date', '2026-02-07')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid end date', async () => {
      await expect(
        controller.getEventStats('G1', '2026-02-07', 'invalid-date')
      ).rejects.toThrow(BadRequestException);
    });

    it('should use default dates when not provided', async () => {
      service.getEventStats.mockResolvedValue({
        lot_id: 'G1',
        start_date: '2026-02-07',
        end_date: '2026-02-07T23:59:59.999Z',
        total_enters: 0,
        total_exits: 0,
        net_change: 0,
      });

      await controller.getEventStats('G1');

      expect(service.getEventStats).toHaveBeenCalled();
      const [, startDate] = service.getEventStats.mock.calls[0];
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('createSnapshots', () => {
    it('should trigger snapshot creation', async () => {
      service.createSnapshots.mockResolvedValue({
        count: 25,
        timestamp: '2026-02-07T14:30:00.000Z',
      });

      const result = await controller.createSnapshots();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Created 25 occupancy snapshots');
      expect(result.data.count).toBe(25);
    });
  });

  describe('getSnapshots', () => {
    it('should return snapshots for a lot', async () => {
      const mockSnapshots = [
        { lot_id: 'G1', timestamp: '2026-02-07T10:00:00Z', occupancy: 50 },
        { lot_id: 'G1', timestamp: '2026-02-07T10:15:00Z', occupancy: 52 },
      ];

      service.getSnapshots.mockResolvedValue(mockSnapshots as never);

      const result = await controller.getSnapshots('g1', '2026-02-07');

      expect(result.success).toBe(true);
      expect(result.lot_id).toBe('G1');
      expect(result.count).toBe(2);
      expect(service.getSnapshots).toHaveBeenCalledWith('G1', '2026-02-07', 96);
    });

    it('should throw BadRequestException for invalid date format', async () => {
      await expect(
        controller.getSnapshots('G1', 'invalid-date')
      ).rejects.toThrow(BadRequestException);
    });

    it('should use today as default date', async () => {
      service.getSnapshots.mockResolvedValue([]);

      await controller.getSnapshots('G1');

      const [, date] = service.getSnapshots.mock.calls[0];
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
