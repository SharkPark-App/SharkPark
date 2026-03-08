import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { LotsService } from './lots.service';
import { PrismaService } from '../database/database.module';
import { PenetrationEstimationService } from './penetration-estimation.service';

describe('LotsService', () => {
  let service: LotsService;
  let prisma: {
    lot: { findMany: jest.Mock; findFirst: jest.Mock };
    occupancySnapshot: { findMany: jest.Mock };
  };
  let penetrationService: {
    estimateForAllLots: jest.Mock;
    estimateForLot: jest.Mock;
  };

  /** Helper: builds a default PenetrationEstimate from a lot's raw values */
  const makeEstimate = (lot: { current_occupancy: number; capacity: number }) => ({
    effectiveRate: 1,
    rawOccupancy: lot.current_occupancy,
    estimatedOccupancy: lot.current_occupancy,
    estimatedRate: lot.capacity > 0 ? lot.current_occupancy / lot.capacity : 0,
    campusDevices: 0,
    adjustedCommuters: 0,
    isClosure: false,
  });

  beforeEach(async () => {
    prisma = {
      lot: { findMany: jest.fn(), findFirst: jest.fn() },
      occupancySnapshot: { findMany: jest.fn() },
    };

    penetrationService = {
      estimateForAllLots: jest.fn().mockImplementation(async (lots: any[]) => {
        const map = new Map();
        for (const lot of lots) {
          map.set(lot.id, makeEstimate(lot));
        }
        return map;
      }),
      estimateForLot: jest.fn().mockImplementation(async (lot: any) => makeEstimate(lot)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PenetrationEstimationService, useValue: penetrationService },
      ],
    }).compile();

    service = module.get<LotsService>(LotsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    const mockLot = {
      id: 'uuid-1',
      lot_id: 'G1',
      lot_name: 'Lot G1',
      capacity: 100,
      current_occupancy: 50,
      lot_type: 'STUDENT',
      permit_types: ['Gold'],
      daily_permit_allowed: true,
      ev_charging_stations: 2,
      school_id: 'school-1',
      penetration_rate: 0.65,
      latitude: 33.78,
      longitude: -118.11,
      geofence_coordinates: [],
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('should return all parking lots', async () => {
      prisma.lot.findMany.mockResolvedValue([mockLot]);

      const result = await service.findAll();

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].lot_id).toBe('G1');
      expect(result[0].available).toBe(50);
      expect(result[0].occupancy_rate).toBeDefined();
    });

    it('should return empty array when no lots exist', async () => {
      prisma.lot.findMany.mockResolvedValue([]);
      const result = await service.findAll();
      expect(result).toEqual([]);
    });

    it('should pass type filter to Prisma', async () => {
      prisma.lot.findMany.mockResolvedValue([]);
      await service.findAll({ type: 'STUDENT' });
      expect(prisma.lot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lot_type: 'STUDENT' }),
        }),
      );
    });

    it('should filter by available_only after fetch', async () => {
      const fullLot = { ...mockLot, id: 'uuid-full', lot_id: 'G2', current_occupancy: 100 };
      prisma.lot.findMany.mockResolvedValue([mockLot, fullLot]);
      const result = await service.findAll({ available_only: true });
      expect(result).toHaveLength(1);
      expect(result[0].lot_id).toBe('G1');
    });

    it('should filter by min_available after estimation', async () => {
      const smallLot = { ...mockLot, id: 'uuid-small', lot_id: 'G3', capacity: 100, current_occupancy: 80 };
      // G1: available = 50, G3: available = 20
      prisma.lot.findMany.mockResolvedValue([mockLot, smallLot]);
      const result = await service.findAll({ min_available: 30 });
      expect(result).toHaveLength(1);
      expect(result[0].lot_id).toBe('G1');
    });

    it('should throw InternalServerErrorException on error', async () => {
      prisma.lot.findMany.mockRejectedValue(new Error('DB error'));
      await expect(service.findAll()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('findOne', () => {
    it('should return a parking lot by lot_id', async () => {
      const mockLot = {
        id: 'uuid-1', lot_id: 'G1', lot_name: 'Lot G1', capacity: 100,
        current_occupancy: 50, lot_type: 'STUDENT', permit_types: [],
        daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
        penetration_rate: 0.5, latitude: 33.78, longitude: -118.11,
        geofence_coordinates: [], created_at: new Date(), updated_at: new Date(),
      };
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      const result = await service.findOne('G1');
      expect(result).toBeDefined();
      expect(result.lot_id).toBe('G1');
      expect(prisma.lot.findFirst).toHaveBeenCalledWith({ where: { lot_id: 'G1' } });
    });

    it('should throw NotFoundException when lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);
      await expect(service.findOne('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException on non-NotFoundException', async () => {
      prisma.lot.findFirst.mockRejectedValue(new Error('Connection lost'));
      await expect(service.findOne('G1')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getOccupancySummary', () => {
    it('should calculate totals across all lots', async () => {
      const lots = [
        {
          id: 'uuid-1', lot_id: 'G1', lot_name: 'Lot G1', capacity: 100,
          current_occupancy: 50, lot_type: 'STUDENT', permit_types: [],
          daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
          penetration_rate: 0.5, latitude: 33.78, longitude: -118.11,
          geofence_coordinates: [], created_at: new Date(), updated_at: new Date(),
        },
        {
          id: 'uuid-2', lot_id: 'E7', lot_name: 'Lot E7', capacity: 80,
          current_occupancy: 30, lot_type: 'EMPLOYEE', permit_types: [],
          daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
          penetration_rate: 0.5, latitude: 33.78, longitude: -118.11,
          geofence_coordinates: [], created_at: new Date(), updated_at: new Date(),
        },
      ];
      prisma.lot.findMany.mockResolvedValue(lots);

      const summary = await service.getOccupancySummary();

      expect(summary.total_lots).toBe(2);
      expect(summary.total_capacity).toBe(180);
      expect(summary.total_occupied).toBe(80);
      expect(summary.total_available).toBe(100);
      expect(summary.overall_occupancy_rate).toBeCloseTo(80 / 180, 2);
      expect(summary.student_lots.count).toBe(1);
      expect(summary.student_lots.capacity).toBe(100);
      expect(summary.student_lots.occupied).toBe(50);
      expect(summary.employee_lots.count).toBe(1);
      expect(summary.employee_lots.capacity).toBe(80);
      expect(summary.employee_lots.occupied).toBe(30);
    });

    it('should return zero rate when total capacity is zero', async () => {
      prisma.lot.findMany.mockResolvedValue([]);
      const summary = await service.getOccupancySummary();
      expect(summary.total_lots).toBe(0);
      expect(summary.overall_occupancy_rate).toBe(0);
    });

    it('should throw InternalServerErrorException on error', async () => {
      prisma.lot.findMany.mockRejectedValue(new Error('Boom'));
      await expect(service.getOccupancySummary()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getHistory', () => {
    it('should return occupancy snapshots for a lot on a date', async () => {
      const mockLot = { id: 'uuid-1', lot_id: 'G1' };
      const mockSnapshots = [
        { lot_id: 'uuid-1', timestamp: new Date('2026-02-07T10:00:00Z'), occupancy: 50, available: 50, occupancy_rate: 0.5, confidence: 'HIGH' },
        { lot_id: 'uuid-1', timestamp: new Date('2026-02-07T10:15:00Z'), occupancy: 52, available: 48, occupancy_rate: 0.52, confidence: 'HIGH' },
      ];
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancySnapshot.findMany.mockResolvedValue(mockSnapshots);
      const result = await service.getHistory('G1', '2026-02-07');
      expect(result).toHaveLength(2);
      expect(result[0].lot_id).toBe('G1');
    });

    it('should throw NotFoundException when lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);
      await expect(service.getHistory('INVALID', '2026-02-07')).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException on non-NotFoundException', async () => {
      prisma.lot.findFirst.mockRejectedValue(new Error('Connection lost'));
      await expect(service.getHistory('G1', '2026-02-07')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getRecommendations', () => {
    // Shared mock lot factory — all lots are STUDENT with Gold permits at CSULB coordinates
    const makeLot = (overrides: Record<string, unknown>) => ({
      id: 'uuid-source',
      lot_id: 'G1',
      lot_name: 'Lot G1',
      display_name: 'Lot G1 - East Campus',
      lot_number: 'G1',
      lot_type: 'STUDENT',
      capacity: 200,
      current_occupancy: 190, // 95% — full
      location_description: 'East Campus',
      building_proximity: ['ECS'],
      center_lat: 33.7838,
      center_lng: -118.1089,
      geofence_polygon: [],
      geofence_radius: 50,
      permit_types: ['Gold', 'Green'],
      daily_permit_allowed: false,
      daily_rate: null,
      hours_weekday: { open: '06:00', close: '22:00' },
      hours_saturday: { open: '08:00', close: '18:00' },
      hours_sunday: 'CLOSED',
      ev_charging_stations: 0,
      motorcycle_spaces: 4,
      accessible_spaces: 8,
      has_lighting: true,
      has_cameras: true,
      has_emergency_phone: true,
      is_covered: false,
      is_paved: true,
      levels: null,
      penetration_rate: 0.15,
      avg_turnover_minutes: 240,
      confidence: 'HIGH',
      school_id: 'school-1',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    });

    const sourceLot = makeLot({
      id: 'uuid-source',
      lot_id: 'G1',
      current_occupancy: 190,
      capacity: 200,
      center_lat: 33.7838,
      center_lng: -118.1089,
    });

    // Candidate: nearby, lots of availability
    const nearbyAvailable = makeLot({
      id: 'uuid-nearby',
      lot_id: 'G2',
      lot_name: 'Lot G2',
      display_name: 'Lot G2 - Walter Pyramid',
      current_occupancy: 100,
      capacity: 400,
      center_lat: 33.7825,   // ~150m south
      center_lng: -118.1098,
    });

    // Candidate: far away, moderately available
    const farAvailable = makeLot({
      id: 'uuid-far',
      lot_id: 'G14',
      lot_name: 'Lot G14',
      display_name: 'Lot G14 - Beachside',
      current_occupancy: 100,
      capacity: 262,
      center_lat: 33.7790,   // ~600m away
      center_lng: -118.1175,
    });

    // Candidate: full (≥95% occupancy — should be excluded)
    const fullLot = makeLot({
      id: 'uuid-full',
      lot_id: 'G9',
      lot_name: 'Lot G9',
      display_name: 'Lot G9 - Library',
      current_occupancy: 385,
      capacity: 400,
      center_lat: 33.7817,
      center_lng: -118.1152,
    });

    // Candidate: nearly full (≥75% occupancy — should also be excluded from recommendations)
    const nearlyFullLot = makeLot({
      id: 'uuid-nearly-full',
      lot_id: 'G10',
      lot_name: 'Lot G10',
      display_name: 'Lot G10 - Science',
      current_occupancy: 320,
      capacity: 400,
      center_lat: 33.7820,
      center_lng: -118.1140,
    });

    // Candidate: different permit types (no overlap)
    const noPermitOverlap = makeLot({
      id: 'uuid-nopermit',
      lot_id: 'G5',
      lot_name: 'Lot G5',
      display_name: 'Lot G5 - West Campus',
      current_occupancy: 20,
      capacity: 120,
      center_lat: 33.7805,
      center_lng: -118.1165,
      permit_types: ['Purple'], // no overlap with Gold/Green
    });

    it('should throw NotFoundException when source lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);
      await expect(service.getRecommendations('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('should return recommendations sorted by score (descending)', async () => {
      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([nearbyAvailable, farAvailable, noPermitOverlap]);

      const results = await service.getRecommendations('G1');

      expect(results.length).toBeGreaterThanOrEqual(2);
      // Scores should be descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].recommendation_score).toBeGreaterThanOrEqual(
          results[i].recommendation_score,
        );
      }
    });

    it('should exclude the source lot (via Prisma query)', async () => {
      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([nearbyAvailable]);

      await service.getRecommendations('G1');

      expect(prisma.lot.findMany).toHaveBeenCalledWith({
        where: {
          lot_type: 'STUDENT',
          id: { not: 'uuid-source' },
        },
      });
    });

    it('should exclude full lots (≥75% occupancy)', async () => {
      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([nearbyAvailable, fullLot, nearlyFullLot]);

      const results = await service.getRecommendations('G1');

      const lotIds = results.map(r => r.lot_id);
      expect(lotIds).toContain('G2');
      expect(lotIds).not.toContain('G9');   // 96% — excluded
      expect(lotIds).not.toContain('G10');  // 80% — excluded
    });

    it('should rank a nearby lot higher than a far lot at equal availability', async () => {
      // Both at 50% occupancy, but different distances
      const nearEqual = makeLot({
        id: 'uuid-near-eq',
        lot_id: 'GA',
        current_occupancy: 100,
        capacity: 200,
        center_lat: 33.7840,
        center_lng: -118.1090,
      });
      const farEqual = makeLot({
        id: 'uuid-far-eq',
        lot_id: 'GB',
        current_occupancy: 100,
        capacity: 200,
        center_lat: 33.7700, // much farther
        center_lng: -118.1200,
      });

      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([farEqual, nearEqual]);

      const results = await service.getRecommendations('G1');

      expect(results[0].lot_id).toBe('GA'); // nearer should rank first
    });

    it('should rank a lot with more availability higher than one with less (equal distance)', async () => {
      // Both equidistant but different occupancy
      const emptyLot = makeLot({
        id: 'uuid-empty',
        lot_id: 'GC',
        current_occupancy: 20,
        capacity: 200,
        center_lat: 33.7835,
        center_lng: -118.1095,
      });
      const busyLot = makeLot({
        id: 'uuid-busy',
        lot_id: 'GD',
        current_occupancy: 140,
        capacity: 200,
        center_lat: 33.7835,
        center_lng: -118.1095,
      });

      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([busyLot, emptyLot]);

      const results = await service.getRecommendations('G1');

      expect(results[0].lot_id).toBe('GC'); // more available should rank first
    });

    it('should give lower score when permits do not overlap', async () => {
      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([nearbyAvailable, noPermitOverlap]);

      const results = await service.getRecommendations('G1');

      const withOverlap = results.find(r => r.lot_id === 'G2');
      const withoutOverlap = results.find(r => r.lot_id === 'G5');

      expect(withOverlap).toBeDefined();
      expect(withoutOverlap).toBeDefined();
      expect(withOverlap!.recommendation_score).toBeGreaterThan(
        withoutOverlap!.recommendation_score,
      );
    });

    it('should respect the limit parameter', async () => {
      const manyCandidates = Array.from({ length: 10 }, (_, i) =>
        makeLot({
          id: `uuid-${i}`,
          lot_id: `GX${i}`,
          current_occupancy: 50 + i * 10,
          capacity: 200,
          center_lat: 33.7838 + i * 0.001,
          center_lng: -118.1089,
        }),
      );

      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue(manyCandidates);

      const results = await service.getRecommendations('G1', 3);

      expect(results).toHaveLength(3);
    });

    it('should include distance_meters, recommendation_score, and reason in each result', async () => {
      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([nearbyAvailable]);

      const results = await service.getRecommendations('G1');

      expect(results).toHaveLength(1);
      const rec = results[0];
      expect(rec).toHaveProperty('recommendation_score');
      expect(rec).toHaveProperty('distance_meters');
      expect(rec).toHaveProperty('reason');
      expect(typeof rec.recommendation_score).toBe('number');
      expect(typeof rec.distance_meters).toBe('number');
      expect(typeof rec.reason).toBe('string');
      expect(rec.recommendation_score).toBeGreaterThan(0);
      expect(rec.recommendation_score).toBeLessThanOrEqual(100);
      expect(rec.distance_meters).toBeGreaterThan(0);
      expect(rec.reason.length).toBeGreaterThan(0);
    });

    it('should return empty array when no non-full candidates exist', async () => {
      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([fullLot]);

      const results = await service.getRecommendations('G1');

      expect(results).toEqual([]);
    });

    it('should return empty array when there are no other lots of the same type', async () => {
      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([]);

      const results = await service.getRecommendations('G1');

      expect(results).toEqual([]);
    });
  });
});
