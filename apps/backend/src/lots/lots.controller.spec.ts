import { Test, TestingModule } from '@nestjs/testing';
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
});
