import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { LotsService } from './lots.service';
import { PrismaService } from '../database/database.module';
import { PenetrationEstimationService } from './penetration-estimation.service';
import { WeatherService } from '../weather/weather.service';

describe('LotsService', () => {
  let service: LotsService;
  let prisma: {
    $queryRaw: jest.Mock;
    lot: { findMany: jest.Mock; findFirst: jest.Mock; groupBy: jest.Mock };
    occupancySnapshot: { findMany: jest.Mock; groupBy: jest.Mock };
    predictionShortTerm: { findMany: jest.Mock };
    predictionLongTerm: { findMany: jest.Mock };
  };
  let penetrationService: {
    estimateForAllLots: jest.Mock;
    estimateForLot: jest.Mock;
    getSchoolTimezone: jest.Mock;
  };
  let weatherService: {
    getCurrent: jest.Mock;
  };

  /** Helper: builds a default PenetrationEstimate from a lot's raw values */
  const makeEstimate = (lot: { current_occupancy: number; capacity: number }) => ({
    rawOccupancy: lot.current_occupancy,
    estimatedOccupancy: lot.current_occupancy,
    estimatedRate: lot.capacity > 0 ? lot.current_occupancy / lot.capacity : 0,
    campusDevices: 0,
    adjustedCommuters: 0,
    isClosure: false,
  });

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      lot: { findMany: jest.fn(), findFirst: jest.fn(), groupBy: jest.fn() },
      occupancySnapshot: { findMany: jest.fn(), groupBy: jest.fn() },
      predictionShortTerm: { findMany: jest.fn().mockResolvedValue([]) },
      predictionLongTerm: { findMany: jest.fn().mockResolvedValue([]) },
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
      getSchoolTimezone: jest.fn().mockResolvedValue('America/Los_Angeles'),
    };

    weatherService = {
      getCurrent: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PenetrationEstimationService, useValue: penetrationService },
        { provide: WeatherService, useValue: weatherService },
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
      latitude: 33.78,
      longitude: -118.11,
      geofence_coordinates: [],
      lot_buildings: [], lot_advisories: [],
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
        latitude: 33.78, longitude: -118.11,
        geofence_coordinates: [], lot_buildings: [], lot_advisories: [], created_at: new Date(), updated_at: new Date(),
      };
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      const result = await service.findOne('G1');
      expect(result).toBeDefined();
      expect(result.lot_id).toBe('G1');
      expect(prisma.lot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lot_id: 'G1' } }),
      );
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
          latitude: 33.78, longitude: -118.11,
          geofence_coordinates: [], lot_buildings: [], lot_advisories: [], created_at: new Date(), updated_at: new Date(),
        },
        {
          id: 'uuid-2', lot_id: 'E7', lot_name: 'Lot E7', capacity: 80,
          current_occupancy: 30, lot_type: 'EMPLOYEE', permit_types: [],
          daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
          latitude: 33.78, longitude: -118.11,
          geofence_coordinates: [], lot_buildings: [], lot_advisories: [], created_at: new Date(), updated_at: new Date(),
        },
      ];
      prisma.lot.findMany.mockResolvedValue(lots);
      prisma.lot.groupBy.mockResolvedValue([
        { lot_type: 'STUDENT', _count: { id: 1 }, _sum: { capacity: 100, current_occupancy: 50 } },
        { lot_type: 'EMPLOYEE', _count: { id: 1 }, _sum: { capacity: 80, current_occupancy: 30 } },
      ]);

      const summary = await service.getOccupancySummary();

      expect(summary.total_lots).toBe(2);
      expect(summary.total_capacity).toBe(180);
      expect(summary.total_occupied).toBe(80);
      expect(summary.total_available).toBe(100);
      expect(summary.overall_occupancy_rate).toBeCloseTo(80 / 180, 2);
      expect(summary.by_type.STUDENT.lots).toBe(1);
      expect(summary.by_type.STUDENT.capacity).toBe(100);
      expect(summary.by_type.STUDENT.occupied).toBe(50);
      expect(summary.by_type.STUDENT.available).toBe(50);
      expect(summary.by_type.EMPLOYEE.lots).toBe(1);
      expect(summary.by_type.EMPLOYEE.capacity).toBe(80);
      expect(summary.by_type.EMPLOYEE.occupied).toBe(30);
      expect(summary.by_type.EMPLOYEE.available).toBe(50);
      expect(summary.high_occupancy_lots).toBeDefined();
      expect(summary.timestamp).toBeDefined();
    });

    it('should include high occupancy lots in summary', async () => {
      const lots = [
        {
          id: 'uuid-1', lot_id: 'G1', lot_name: 'Lot G1', capacity: 100,
          current_occupancy: 90, lot_type: 'STUDENT', permit_types: [],
          daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
          latitude: 33.78, longitude: -118.11,
          geofence_coordinates: [], lot_buildings: [], lot_advisories: [], created_at: new Date(), updated_at: new Date(),
        },
        {
          id: 'uuid-2', lot_id: 'E7', lot_name: 'Lot E7', capacity: 80,
          current_occupancy: 10, lot_type: 'EMPLOYEE', permit_types: [],
          daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
          latitude: 33.78, longitude: -118.11,
          geofence_coordinates: [], lot_buildings: [], lot_advisories: [], created_at: new Date(), updated_at: new Date(),
        },
      ];
      prisma.lot.findMany.mockResolvedValue(lots);
      prisma.lot.groupBy.mockResolvedValue([
        { lot_type: 'STUDENT', _count: { id: 1 }, _sum: { capacity: 100, current_occupancy: 90 } },
        { lot_type: 'EMPLOYEE', _count: { id: 1 }, _sum: { capacity: 80, current_occupancy: 10 } },
      ]);

      const summary = await service.getOccupancySummary();

      // G1 at 90% should be in high_occupancy_lots (>= 75%)
      expect(summary.high_occupancy_lots).toHaveLength(1);
      expect(summary.high_occupancy_lots[0].lot_id).toBe('G1');
    });

    it('should return zero rate when total capacity is zero', async () => {
      prisma.lot.findMany.mockResolvedValue([]);
      prisma.lot.groupBy.mockResolvedValue([]);
      const summary = await service.getOccupancySummary();
      expect(summary.total_lots).toBe(0);
      expect(summary.overall_occupancy_rate).toBe(0);
    });

    it('should throw InternalServerErrorException on error', async () => {
      prisma.lot.groupBy.mockRejectedValue(new Error('Boom'));
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
      lot_buildings: [{ building: { name: 'ECS' } }],
      lot_advisories: [],
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
      short_term_parking_spaces: 0,
      low_emission_spaces: 0,
      pay_stations: 0,
      has_lighting: true,
      has_cameras: true,
      has_emergency_phone: true,
      is_covered: false,
      is_paved: true,
      has_solar_canopy: false,
      levels: null,
      metadata_confidence: 'HIGH',
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

      expect(prisma.lot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lot_type: { in: expect.arrayContaining(['STUDENT']) },
            id: { not: 'uuid-source' },
          }),
        }),
      );
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

    it('caps distance contribution at MAX_DISTANCE_METERS (1000m)', async () => {
      // Two candidates with identical availability and permits, both well
      // beyond the 1000 m normalization ceiling. They should score equally
      // because the distance axis contributes 0 for both — guards the
      // chosen MAX_DISTANCE_METERS = 1000 against accidental regressions
      // back to the old 2000 m value (which would let the closer one win).
      // Source is at (33.7838, -118.1089). 0.01° lat ≈ 1110 m.
      const justBeyondCeiling = makeLot({
        id: 'uuid-1100m',
        lot_id: 'GZ1',
        current_occupancy: 100,
        capacity: 200,
        center_lat: 33.7738, // ~1110 m south
        center_lng: -118.1089,
      });
      const wayBeyondCeiling = makeLot({
        id: 'uuid-5000m',
        lot_id: 'GZ2',
        current_occupancy: 100,
        capacity: 200,
        center_lat: 33.7388, // ~5000 m south
        center_lng: -118.1089,
      });

      prisma.lot.findFirst.mockResolvedValue(sourceLot);
      prisma.lot.findMany.mockResolvedValue([justBeyondCeiling, wayBeyondCeiling]);

      const results = await service.getRecommendations('G1');

      const close = results.find((r) => r.lot_id === 'GZ1');
      const far = results.find((r) => r.lot_id === 'GZ2');
      expect(close).toBeDefined();
      expect(far).toBeDefined();
      // Both should have identical scores (distance saturates to 0 for both).
      expect(close!.recommendation_score).toBe(far!.recommendation_score);
    });
  });

  describe('getShortTermPredictions', () => {
    const mockLot = { id: 'uuid-1', lot_id: 'G1' };

    it('should throw NotFoundException when lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);
      await expect(service.getShortTermPredictions('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('should return predictions with weather context (no event coupling)', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.predictionShortTerm.findMany.mockResolvedValue([
        {
          target_time: new Date('2026-03-01T14:00:00Z'),
          predicted_occupancy: 150,
          confidence_lower: 130,
          confidence_upper: 170,
          model_version: 'v1.0',
        },
      ]);

      weatherService.getCurrent.mockResolvedValue({
        conditions: 'Sunny',
        temperature_f: 72,
        is_raining: false,
        precipitation_probability: 0,
      });

      const result = await service.getShortTermPredictions('G1');

      expect(result.lot_id).toBe('G1');
      expect(result.predictions).toHaveLength(1);
      // Per 2026-04-30 product decision, predictions response no longer carries event_impacts.
      expect(result).not.toHaveProperty('event_impacts');
      expect(result.weather).toBeDefined();
      expect(result.weather!.conditions).toBe('Sunny');
    });

    it('should return null weather when no weather data available', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.predictionShortTerm.findMany.mockResolvedValue([]);
      weatherService.getCurrent.mockResolvedValue(null);

      const result = await service.getShortTermPredictions('G1');

      expect(result.weather).toBeNull();
      expect(result.predictions).toEqual([]);
    });
  });

  describe('getLongTermPredictions', () => {
    const mockLotFull = {
      id: 'uuid-1', lot_id: 'G1', capacity: 200, current_occupancy: 100,
      lot_type: 'STUDENT', lot_name: 'Lot G1',
    };

    it('should throw NotFoundException when lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);
      await expect(service.getLongTermPredictions('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('should return ML predictions when available', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLotFull);
      prisma.predictionLongTerm.findMany.mockResolvedValue([
        {
          target_date: new Date('2026-04-13'),
          target_hour: 10,
          predicted_occupancy: 150,
          confidence_lower: 130,
          confidence_upper: 170,
          model_version: 'xgboost-v2',
        },
      ]);

      const result = await service.getLongTermPredictions('G1', 7);

      expect(result.source).toBe('ml');
      expect(result.predictions).toHaveLength(1);
      expect(result.predictions[0].model_version).toBe('xgboost-v2');
    });

    it('should fall back to heuristic when no ML predictions exist', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLotFull);
      prisma.predictionLongTerm.findMany.mockResolvedValue([]);

      const result = await service.getLongTermPredictions('G1', 1);

      expect(result.source).toBe('heuristic');
      expect(result.predictions.length).toBeGreaterThan(0);
      expect(result.predictions[0].model_version).toBe('heuristic-v1');
    });

    it('should generate heuristic predictions for campus hours only', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLotFull);
      prisma.predictionLongTerm.findMany.mockResolvedValue([]);

      const result = await service.getLongTermPredictions('G1', 1);

      // Campus hours: 6 AM to 9 PM (16 hours)
      expect(result.predictions.length).toBe(16);
      expect(result.predictions[0].target_hour).toBe(6);
      expect(result.predictions[result.predictions.length - 1].target_hour).toBe(21);
    });

    it('should bound heuristic predicted_occupancy rates to [0, 1]', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLotFull);
      prisma.predictionLongTerm.findMany.mockResolvedValue([]);

      const result = await service.getLongTermPredictions('G1', 1);

      for (const p of result.predictions) {
        expect(p.predicted_occupancy).toBeGreaterThanOrEqual(0);
        expect(p.predicted_occupancy).toBeLessThanOrEqual(1);
        expect(p.confidence_lower).toBeGreaterThanOrEqual(0);
        expect(p.confidence_upper).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('parseRangeDays', () => {
    it('returns defaultDays when range is undefined', () => {
      expect(service.parseRangeDays(undefined, 7, 90)).toBe(7);
    });

    it('parses a valid range string', () => {
      expect(service.parseRangeDays('14d', 7, 90)).toBe(14);
    });

    it('clamps to maxDays', () => {
      expect(service.parseRangeDays('200d', 7, 90)).toBe(90);
    });

    it('clamps to minimum of 1', () => {
      expect(service.parseRangeDays('0d', 7, 90)).toBe(1);
    });

    it('returns defaultDays for non-matching format', () => {
      expect(service.parseRangeDays('1week', 7, 90)).toBe(7);
    });
  });

  describe('getTrends', () => {
    const mockLot = {
      id: 'uuid-1', lot_id: 'G1', lot_name: 'Lot G1', capacity: 100,
      current_occupancy: 50, lot_type: 'STUDENT', permit_types: [],
      daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
      penetration_rate: 0.5, latitude: 33.78, longitude: -118.11,
      geofence_coordinates: [], created_at: new Date(), updated_at: new Date(),
    };

    it('returns mapped trend points from raw query', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.$queryRaw.mockResolvedValue([
        {
          hour: new Date('2026-04-25T08:00:00Z'),
          avg_occupancy_rate: 0.55,
          avg_occupancy: 55,
          avg_available: 45,
          sample_count: BigInt(4),
        },
      ]);

      const result = await service.getTrends('G1', 7);

      expect(result).toHaveLength(1);
      expect(result[0].hour).toBe('2026-04-25T08:00:00.000Z');
      expect(result[0].avg_occupancy_rate).toBe(0.55);
      expect(result[0].sample_count).toBe(4);
    });

    it('returns empty array when no snapshots exist', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getTrends('G1', 7);
      expect(result).toEqual([]);
    });

    it('throws NotFoundException for unknown lot', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);
      await expect(service.getTrends('INVALID', 7)).rejects.toThrow(NotFoundException);
    });

    it('throws InternalServerErrorException on DB failure', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.$queryRaw.mockRejectedValue(new Error('DB error'));
      await expect(service.getTrends('G1', 7)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getUtilization', () => {
    const lots = [
      {
        id: 'uuid-1', lot_id: 'G1', display_name: 'Lot G1', lot_name: 'Lot G1',
        capacity: 100, current_occupancy: 50, lot_type: 'STUDENT', permit_types: [],
        daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
        penetration_rate: 0.5, latitude: 33.78, longitude: -118.11,
        geofence_coordinates: [], created_at: new Date(), updated_at: new Date(),
      },
      {
        id: 'uuid-2', lot_id: 'E1', display_name: 'Lot E1', lot_name: 'Lot E1',
        capacity: 80, current_occupancy: 20, lot_type: 'EMPLOYEE', permit_types: [],
        daily_permit_allowed: false, ev_charging_stations: 0, school_id: 'school-1',
        penetration_rate: 0.5, latitude: 33.78, longitude: -118.11,
        geofence_coordinates: [], created_at: new Date(), updated_at: new Date(),
      },
    ];

    it('returns per-lot utilization sorted descending', async () => {
      prisma.lot.findMany.mockResolvedValue(lots);
      prisma.occupancySnapshot.groupBy.mockResolvedValue([
        { lot_id: 'uuid-1', _avg: { occupancy_rate: 0.72 }, _count: { id: 10 } },
        { lot_id: 'uuid-2', _avg: { occupancy_rate: 0.40 }, _count: { id: 8 } },
      ]);

      const result = await service.getUtilization(30);

      expect(result).toHaveLength(2);
      expect(result[0].lot_id).toBe('G1');
      expect(result[0].avg_utilization).toBe(0.72);
      expect(result[0].snapshot_count).toBe(10);
      expect(result[1].lot_id).toBe('E1');
    });

    it('sets avg_utilization to null for lots with no snapshots', async () => {
      prisma.lot.findMany.mockResolvedValue(lots);
      prisma.occupancySnapshot.groupBy.mockResolvedValue([]);

      const result = await service.getUtilization(30);

      expect(result).toHaveLength(2);
      expect(result[0].avg_utilization).toBeNull();
      expect(result[0].snapshot_count).toBe(0);
    });

    it('sets avg_utilization to null when avg occupancy_rate is null', async () => {
      prisma.lot.findMany.mockResolvedValue(lots);
      prisma.occupancySnapshot.groupBy.mockResolvedValue([
        { lot_id: 'uuid-1', _avg: { occupancy_rate: null }, _count: { id: 3 } },
      ]);

      const result = await service.getUtilization(30);

      const g1 = result.find(r => r.lot_id === 'G1');
      expect(g1?.avg_utilization).toBeNull();
      expect(g1?.snapshot_count).toBe(3);
    });

    it('throws InternalServerErrorException on DB failure', async () => {
      prisma.lot.findMany.mockRejectedValue(new Error('DB error'));
      await expect(service.getUtilization(30)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
