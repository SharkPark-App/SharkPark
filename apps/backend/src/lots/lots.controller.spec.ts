import { Test, TestingModule } from '@nestjs/testing';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { ContributorGuard } from '../auth/contributor.guard';
import { ContributorService } from '../auth/contributor.service';
import { EventsService } from '../events/events.service';

describe('LotsController', () => {
  let controller: LotsController;
  let service: LotsService;

  const mockLotsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    getHistory: jest.fn(),
    getOccupancySummary: jest.fn(),
    getRecommendations: jest.fn(),
  };

  // Default to "is contributor" so existing test cases see the unredacted shape.
  // Individual tests can override per-call to exercise the redaction path.
  const mockContributorService = {
    isContributor: jest.fn().mockResolvedValue(true),
  };

  const mockEventsService = {
    getEventsForLot: jest.fn(),
  };

  beforeEach(async () => {
    mockContributorService.isContributor.mockClear();
    mockContributorService.isContributor.mockResolvedValue(true);
    mockEventsService.getEventsForLot.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LotsController],
      providers: [
        {
          provide: LotsService,
          useValue: mockLotsService,
        },
        {
          provide: ContributorService,
          useValue: mockContributorService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
      ],
    })
      // ContributorGuard depends on ContributorService which is mocked above,
      // but the guard's own behavior is covered by its dedicated spec; here we
      // just need the controller to resolve and let the request through.
      .overrideGuard(ContributorGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

      const result = await controller.getAllLots('device-abc');

      expect(result).toEqual({
        success: true,
        count: mockLots.length,
        data: mockLots,
      });
      expect(service.findAll).toHaveBeenCalledWith(expect.any(Object), { redactLive: false });
    });

    it('should pass query parameters to service', async () => {
      mockLotsService.findAll.mockResolvedValue([]);

      await controller.getAllLots('device-abc', 'STUDENT', true, 10, 'Gold', false, true);

      expect(service.findAll).toHaveBeenCalledWith(
        {
          type: 'STUDENT',
          available_only: true,
          min_available: 10,
          permit_type: 'Gold',
          daily_permit: false,
          ev_charging: true,
        },
        { redactLive: false },
      );
    });

    it('redacts live fields when caller is not a contributor', async () => {
      mockContributorService.isContributor.mockResolvedValue(false);
      mockLotsService.findAll.mockResolvedValue([]);

      await controller.getAllLots(undefined);

      expect(service.findAll).toHaveBeenCalledWith(expect.any(Object), { redactLive: true });
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

      const result = await controller.getLot('G1', 'device-abc');

      expect(result).toEqual({
        success: true,
        data: mockLot,
      });
      expect(service.findOne).toHaveBeenCalledWith('G1', { redactLive: false });
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

  describe('getRecommendations', () => {
    const mockRecommendations = [
      {
        lot_id: 'G2',
        lot_name: 'Lot G2',
        recommendation_score: 78,
        distance_meters: 150,
        reason: '300 spots available · very close by',
        available: 300,
        occupancy_rate: 0.25,
        fill_status: 'AVAILABLE',
      },
      {
        lot_id: 'G4',
        lot_name: 'Lot G4',
        recommendation_score: 62,
        distance_meters: 500,
        reason: '132 spots left, filling up · nearby',
        available: 132,
        occupancy_rate: 0.71,
        fill_status: 'FILLING',
      },
    ];

    it('should return recommendations for a lot', async () => {
      mockLotsService.getRecommendations.mockResolvedValue(mockRecommendations);

      const result = await controller.getRecommendations('G1');

      expect(result).toEqual({
        success: true,
        source_lot: 'G1',
        count: 2,
        data: mockRecommendations,
      });
      expect(service.getRecommendations).toHaveBeenCalledWith('G1', 5);
    });

    it('should uppercase the lot ID', async () => {
      mockLotsService.getRecommendations.mockResolvedValue([]);

      await controller.getRecommendations('g1');

      expect(service.getRecommendations).toHaveBeenCalledWith('G1', 5);
    });

    it('should pass limit parameter when provided', async () => {
      mockLotsService.getRecommendations.mockResolvedValue([]);

      await controller.getRecommendations('G1', 3);

      expect(service.getRecommendations).toHaveBeenCalledWith('G1', 3);
    });

    it('should default limit to 5 when not provided', async () => {
      mockLotsService.getRecommendations.mockResolvedValue([]);

      await controller.getRecommendations('G1');

      expect(service.getRecommendations).toHaveBeenCalledWith('G1', 5);
    });

    it('should cap limit to 5 when out of range', async () => {
      mockLotsService.getRecommendations.mockResolvedValue([]);

      await controller.getRecommendations('G1', 50);

      expect(service.getRecommendations).toHaveBeenCalledWith('G1', 5);
    });

    it('should return empty data array when no recommendations exist', async () => {
      mockLotsService.getRecommendations.mockResolvedValue([]);

      const result = await controller.getRecommendations('G1');

      expect(result).toEqual({
        success: true,
        source_lot: 'G1',
        count: 0,
        data: [],
      });
    });
  });

  describe('getNearbyEvents', () => {
    it('defaults within_hours to 2 and uppercases the lot id', async () => {
      mockEventsService.getEventsForLot.mockResolvedValue([]);

      const result = await controller.getNearbyEvents('g7');

      expect(mockEventsService.getEventsForLot).toHaveBeenCalledWith('G7', 2);
      expect(result).toEqual({
        success: true,
        lot_id: 'G7',
        within_hours: 2,
        count: 0,
        data: [],
      });
    });

    it('passes a caller-supplied within_hours through to the service', async () => {
      const events = [{ id: 'ev-1' }, { id: 'ev-2' }];
      mockEventsService.getEventsForLot.mockResolvedValue(events);

      const result = await controller.getNearbyEvents('G7', 24);

      expect(mockEventsService.getEventsForLot).toHaveBeenCalledWith('G7', 24);
      expect(result).toMatchObject({ within_hours: 24, count: 2, data: events });
    });

    it('rejects out-of-range within_hours values', async () => {
      await expect(controller.getNearbyEvents('G7', 0)).rejects.toThrow(
        /within_hours/,
      );
      await expect(controller.getNearbyEvents('G7', 200)).rejects.toThrow(
        /within_hours/,
      );
      expect(mockEventsService.getEventsForLot).not.toHaveBeenCalled();
    });
  });
});
