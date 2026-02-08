import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';

describe('LotsController', () => {
  let controller: LotsController;
  let service: LotsService;

  const mockLotsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    getHistory: jest.fn(),
    getOccupancySummary: jest.fn(),
    recordOccupancyEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LotsController],
      providers: [
        {
          provide: LotsService,
          useValue: mockLotsService,
        },
      ],
    }).compile();

    controller = module.get<LotsController>(LotsController);
    service = module.get<LotsService>(LotsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAllLots', () => {
    it('should return array of lots', async () => {
      const mockLots = [
        {
          lot_id: 'G1',
          lot_name: 'Lot G1',
          capacity: 100,
          current_occupancy: 50,
          available_spaces: 50,
        },
      ];

      mockLotsService.findAll.mockResolvedValue(mockLots);

      const result = await controller.getAllLots();

      expect(result).toEqual({
        success: true,
        count: mockLots.length,
        data: mockLots,
      });
      expect(service.findAll).toHaveBeenCalled();
    });

    it('should pass query parameters to service', async () => {
      mockLotsService.findAll.mockResolvedValue([]);

      await controller.getAllLots('STUDENT', true, 10, 'Gold', false, true);

      expect(service.findAll).toHaveBeenCalledWith({
        type: 'STUDENT',
        available_only: true,
        min_available: 10,
        permit_type: 'Gold',
        daily_permit: false,
        ev_charging: true,
      });
    });
  });

  describe('getLot', () => {
    it('should return single lot by ID', async () => {
      const mockLot = {
        lot_id: 'G1',
        lot_name: 'Lot G1',
        capacity: 100,
      };

      mockLotsService.findOne.mockResolvedValue(mockLot);

      const result = await controller.getLot('G1');

      expect(result).toEqual({
        success: true,
        data: mockLot,
      });
      expect(service.findOne).toHaveBeenCalledWith('G1');
    });
  });

  describe('getOccupancySummary', () => {
    it('should return occupancy summary', async () => {
      const mockSummary = {
        total_lots: 25,
        total_capacity: 5000,
        total_occupied: 3500,
      };

      mockLotsService.getOccupancySummary.mockResolvedValue(mockSummary);

      const result = await controller.getOccupancySummary();

      expect(result).toEqual({
        success: true,
        data: mockSummary,
      });
      expect(service.getOccupancySummary).toHaveBeenCalled();
    });
  });

  describe('recordOccupancyEvent', () => {
    it('should record an ENTER event successfully', async () => {
      const eventData = {
        lot_id: 'G1',
        event_type: 'ENTER' as const,
        source: 'geofencing',
        timestamp: '2026-02-06T10:30:00Z',
      };

      mockLotsService.recordOccupancyEvent.mockResolvedValue({ id: 'event-123' });

      const result = await controller.recordOccupancyEvent(eventData);

      expect(result).toEqual({
        success: true,
        message: 'Occupancy event recorded successfully',
        event_id: 'event-123',
      });
      expect(service.recordOccupancyEvent).toHaveBeenCalledWith(eventData);
    });

    it('should record an EXIT event successfully', async () => {
      const eventData = {
        lot_id: 'G1',
        event_type: 'EXIT' as const,
        source: 'geofencing',
        timestamp: '2026-02-06T11:00:00Z',
      };

      mockLotsService.recordOccupancyEvent.mockResolvedValue({ id: 'event-456' });

      const result = await controller.recordOccupancyEvent(eventData);

      expect(result).toEqual({
        success: true,
        message: 'Occupancy event recorded successfully',
        event_id: 'event-456',
      });
      expect(service.recordOccupancyEvent).toHaveBeenCalledWith(eventData);
    });

    it('should throw BadRequestException when service fails', async () => {
      const eventData = {
        lot_id: 'INVALID',
        event_type: 'ENTER' as const,
        source: 'geofencing',
        timestamp: '2026-02-06T10:30:00Z',
      };

      mockLotsService.recordOccupancyEvent.mockRejectedValue(new Error('Lot not found'));

      await expect(controller.recordOccupancyEvent(eventData)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
