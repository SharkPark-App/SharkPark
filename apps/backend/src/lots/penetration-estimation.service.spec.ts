import { Test, TestingModule } from '@nestjs/testing';
import { PenetrationEstimationService } from './penetration-estimation.service';
import { PrismaService } from '../database/database.module';
import type { Lot } from '@prisma/client';

// ─── Helpers ─────────────────────────────────────────────

/** Creates a Date for a specific day/time in local timezone */
const dateAt = (year: number, month: number, day: number, hour = 10, minute = 0): Date =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

/** Tuesday, March 10 2026, 10:00 AM — a normal weekday peak time */
const WEEKDAY_PEAK = dateAt(2026, 3, 10, 10, 0);

/** Tuesday, March 10 2026, 8:00 PM — weekday evening */
const WEEKDAY_EVENING = dateAt(2026, 3, 10, 20, 0);

/** Tuesday, March 10 2026, 2:00 AM — weekday night */
const WEEKDAY_NIGHT = dateAt(2026, 3, 10, 2, 0);

/** Saturday, March 14 2026, 12:00 PM — Saturday day */
const SATURDAY_DAY = dateAt(2026, 3, 14, 12, 0);

/** Saturday, March 14 2026, 8:00 PM — Saturday off-peak */
const SATURDAY_NIGHT = dateAt(2026, 3, 14, 20, 0);

/** Sunday, March 15 2026, 12:00 PM */
const SUNDAY = dateAt(2026, 3, 15, 12, 0);

const makeLot = (overrides: Partial<Lot> = {}): Lot => ({
  id: 'lot-1',
  lot_id: 'G1',
  lot_name: 'Lot G1',
  display_name: 'Lot G1',
  lot_number: '1',
  capacity: 1000,
  current_occupancy: 100,
  lot_type: 'STUDENT',
  location_description: 'Near Science Building',
  building_proximity: ['Science'],
  center_lat: 33.78,
  center_lng: -118.11,
  geofence_polygon: [],
  geofence_radius: 100,
  permit_types: ['Gold'],
  daily_permit_allowed: true,
  daily_rate: null,
  hours_weekday: { open: '06:00', close: '22:00' },
  hours_saturday: { open: '06:00', close: '22:00' },
  hours_sunday: { open: '06:00', close: '22:00' },
  ev_charging_stations: 2,
  motorcycle_spaces: 0,
  accessible_spaces: 5,
  has_lighting: true,
  has_cameras: false,
  has_emergency_phone: false,
  is_covered: false,
  is_paved: true,
  levels: null,
  school_id: 'school-1',
  penetration_rate: 0.01,
  avg_turnover_minutes: 0,
  confidence: 'LOW',
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
} as Lot);

// ─── Tests ───────────────────────────────────────────────

describe('PenetrationEstimationService', () => {
  let service: PenetrationEstimationService;
  let prisma: {
    academicCalendar: { findFirst: jest.Mock };
    campusClosure: { findFirst: jest.Mock };
    school: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      academicCalendar: { findFirst: jest.fn().mockResolvedValue(null) },
      campusClosure: { findFirst: jest.fn().mockResolvedValue(null) },
      school: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PenetrationEstimationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PenetrationEstimationService>(PenetrationEstimationService);
    jest.clearAllMocks();
    // Default spy — makes toSchoolTime a no-op so local-time test dates
    // pass through directly to getTimeMultiplier.
    jest.spyOn(service, 'toSchoolTime').mockImplementation((date: Date) => date);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── computeFloor ─────────────────────────────────────

  describe('computeFloor', () => {
    it('returns 15% of capacity at weekday peak', () => {
      // floor(1000 × 0.15 × 1.0) = 150
      expect(service.computeFloor(1000, 1.0, false)).toBe(150);
    });

    it('scales floor by time multiplier', () => {
      // floor(1000 × 0.15 × 0.35) = 52  (weekday evening)
      expect(service.computeFloor(1000, 0.35, false)).toBe(52);
    });

    it('scales floor by Saturday day multiplier', () => {
      // floor(1000 × 0.15 × 0.15) = 22
      expect(service.computeFloor(1000, 0.15, false)).toBe(22);
    });

    it('returns 0 when time multiplier is below threshold', () => {
      // 0.05 < 0.10 threshold → no floor
      expect(service.computeFloor(1000, 0.05, false)).toBe(0);
    });

    it('returns 0 during campus closure regardless of time', () => {
      expect(service.computeFloor(1000, 1.0, true)).toBe(0);
    });

    it('scales proportionally to lot capacity', () => {
      // 500-space lot: floor(500 × 0.15 × 1.0) = 75
      expect(service.computeFloor(500, 1.0, false)).toBe(75);
      // 200-space lot: floor(200 × 0.15 × 1.0) = 30
      expect(service.computeFloor(200, 1.0, false)).toBe(30);
    });
  });

  // ─── getTimeMultiplier ────────────────────────────────

  describe('getTimeMultiplier', () => {
    it('returns 1.0 for weekday peak (7 AM – 6 PM)', () => {
      expect(service.getTimeMultiplier(WEEKDAY_PEAK)).toBe(1.0);
    });

    it('returns 0.35 for weekday evening (6 PM – 10 PM)', () => {
      expect(service.getTimeMultiplier(WEEKDAY_EVENING)).toBe(0.35);
    });

    it('returns 0.05 for weekday night (10 PM – 7 AM)', () => {
      expect(service.getTimeMultiplier(WEEKDAY_NIGHT)).toBe(0.05);
    });

    it('returns 0.15 for Saturday daytime (8 AM – 6 PM)', () => {
      expect(service.getTimeMultiplier(SATURDAY_DAY)).toBe(0.15);
    });

    it('returns 0.05 for Saturday off-peak', () => {
      expect(service.getTimeMultiplier(SATURDAY_NIGHT)).toBe(0.05);
    });

    it('returns 0.05 for Sunday', () => {
      expect(service.getTimeMultiplier(SUNDAY)).toBe(0.05);
    });

    it('returns 1.0 for weekday 7 AM boundary', () => {
      expect(service.getTimeMultiplier(dateAt(2026, 3, 10, 7, 0))).toBe(1.0);
    });

    it('returns 0.35 for weekday 6 PM boundary', () => {
      expect(service.getTimeMultiplier(dateAt(2026, 3, 10, 18, 0))).toBe(0.35);
    });

    it('returns 0.05 for weekday 10 PM boundary', () => {
      expect(service.getTimeMultiplier(dateAt(2026, 3, 10, 22, 0))).toBe(0.05);
    });
  });

  // ─── getMaxScaling ────────────────────────────────────

  describe('getMaxScaling', () => {
    it('returns Infinity for 500+ devices', () => {
      expect(service.getMaxScaling(500)).toBe(Infinity);
      expect(service.getMaxScaling(1000)).toBe(Infinity);
    });

    it('returns 10 for 200–499 devices', () => {
      expect(service.getMaxScaling(200)).toBe(10);
      expect(service.getMaxScaling(499)).toBe(10);
    });

    it('returns 5 for 50–199 devices', () => {
      expect(service.getMaxScaling(50)).toBe(5);
      expect(service.getMaxScaling(199)).toBe(5);
    });

    it('returns 2 for < 50 devices', () => {
      expect(service.getMaxScaling(0)).toBe(2);
      expect(service.getMaxScaling(49)).toBe(2);
    });
  });

  // ─── getExpectedCommuters ─────────────────────────────

  describe('getExpectedCommuters', () => {
    it('returns commuters from matching academic period', async () => {
      prisma.academicCalendar.findFirst.mockResolvedValue({
        period_name: 'Spring 2026',
        expected_commuters: 34_000,
      });

      const result = await service.getExpectedCommuters('school-1', WEEKDAY_PEAK);
      expect(result).toBe(34_000);
    });

    it('falls back to most recent period when no match', async () => {
      prisma.academicCalendar.findFirst
        .mockResolvedValueOnce(null) // no matching period
        .mockResolvedValueOnce({ period_name: 'Fall 2025', expected_commuters: 35_000 }); // most recent

      const result = await service.getExpectedCommuters('school-1', WEEKDAY_PEAK);
      expect(result).toBe(35_000);
    });

    it('returns DEFAULT_COMMUTERS (35000) when no calendar data', async () => {
      prisma.academicCalendar.findFirst.mockResolvedValue(null);

      const result = await service.getExpectedCommuters('school-1', WEEKDAY_PEAK);
      expect(result).toBe(35_000);
    });
  });

  // ─── isCampusClosure ──────────────────────────────────

  describe('isCampusClosure', () => {
    it('returns true when a closure exists for the date', async () => {
      prisma.campusClosure.findFirst.mockResolvedValue({ reason: 'MLK Day' });
      const result = await service.isCampusClosure('school-1', WEEKDAY_PEAK);
      expect(result).toBe(true);
    });

    it('returns false when no closure exists', async () => {
      prisma.campusClosure.findFirst.mockResolvedValue(null);
      const result = await service.isCampusClosure('school-1', WEEKDAY_PEAK);
      expect(result).toBe(false);
    });
  });

  // ─── countCampusDevices ───────────────────────────────

  describe('countCampusDevices', () => {
    it('returns the distinct device count from raw SQL', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(3) }]);
      const result = await service.countCampusDevices('school-1', WEEKDAY_PEAK);
      expect(result).toBe(3);
    });

    it('returns 0 when query returns zero', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(0) }]);
      const result = await service.countCampusDevices('school-1', WEEKDAY_PEAK);
      expect(result).toBe(0);
    });

    it('returns 0 when query returns no rows', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      const result = await service.countCampusDevices('school-1', WEEKDAY_PEAK);
      expect(result).toBe(0);
    });
  });

  // ─── getSchoolTimezone ────────────────────────────────

  describe('getSchoolTimezone', () => {
    it('returns timezone from school record', async () => {
      prisma.school.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
      const result = await service.getSchoolTimezone('school-1');
      expect(result).toBe('America/New_York');
    });

    it('falls back to America/Los_Angeles when school not found', async () => {
      prisma.school.findUnique.mockResolvedValue(null);
      const result = await service.getSchoolTimezone('school-1');
      expect(result).toBe('America/Los_Angeles');
    });
  });

  // ─── toSchoolTime ─────────────────────────────────────

  describe('toSchoolTime', () => {
    beforeEach(() => {
      // Restore the real implementation for this describe block
      (service.toSchoolTime as jest.MockedFunction<typeof service.toSchoolTime>).mockRestore();
    });

    it('converts UTC date to school timezone', () => {
      // 2026-03-10T17:00:00Z in America/Los_Angeles (PDT, UTC-7) = 10:00 AM
      const utc = new Date(Date.UTC(2026, 2, 10, 17, 0));
      const result = service.toSchoolTime(utc, 'America/Los_Angeles');
      expect(result.getHours()).toBe(10);
      expect(result.getDay()).toBe(2); // Tuesday
    });

    it('handles UTC timezone as identity', () => {
      const utc = new Date(Date.UTC(2026, 2, 10, 15, 0));
      const result = service.toSchoolTime(utc, 'UTC');
      expect(result.getHours()).toBe(15);
    });
  });

  // ─── estimateForLot ───────────────────────────────────

  describe('estimateForLot', () => {
    const setupMocks = (opts: {
      commuters?: number;
      closure?: boolean;
      campusDeviceCount?: number;
    } = {}) => {
      const { commuters = 35_000, closure = false, campusDeviceCount = 0 } = opts;

      prisma.academicCalendar.findFirst.mockResolvedValue({
        period_name: 'Spring 2026',
        expected_commuters: commuters,
      });
      prisma.campusClosure.findFirst.mockResolvedValue(closure ? { reason: 'Holiday' } : null);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(campusDeviceCount) }]);
    };

    it('returns floor estimate when lot has zero occupancy during peak hours', async () => {
      setupMocks({ commuters: 35_000 });
      const lot = makeLot({ current_occupancy: 0, capacity: 1000 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      // floor = floor(1000 × 0.15 × 1.0) = 150
      expect(result.rawOccupancy).toBe(0);
      expect(result.estimatedOccupancy).toBe(150);
      expect(result.estimatedRate).toBe(0.15);
      expect(result.effectiveRate).toBe(1);
      expect(result.isClosure).toBe(false);
    });

    it('returns zero when lot has zero occupancy during nighttime', async () => {
      setupMocks({ commuters: 35_000 });
      const lot = makeLot({ current_occupancy: 0, capacity: 1000 });
      const result = await service.estimateForLot(lot, WEEKDAY_NIGHT);

      // timeMultiplier 0.05 < threshold 0.10 → no floor
      expect(result.rawOccupancy).toBe(0);
      expect(result.estimatedOccupancy).toBe(0);
      expect(result.effectiveRate).toBe(1);
    });

    it('returns zero when lot has zero occupancy during closure', async () => {
      setupMocks({ commuters: 35_000, closure: true });
      const lot = makeLot({ current_occupancy: 0, capacity: 1000 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      // closure → no floor applied
      expect(result.rawOccupancy).toBe(0);
      expect(result.estimatedOccupancy).toBe(0);
      expect(result.effectiveRate).toBe(1);
      expect(result.isClosure).toBe(true);
    });

    it('scales up raw occupancy based on penetration rate during weekday peak', async () => {
      // 600 campus devices / 35000 commuters = ~0.0171 rate
      // lot has 100 occupancy, 0.01 pen rate → effective = max(0.0171, 0.01, 0.01) = 0.0171
      // scaling = 1/0.0171 ≈ 58.3 but cap at Infinity (600 devices > 500)
      // min(100 * 58.3, 1000) = 1000 (capped at capacity)
      setupMocks({ commuters: 35_000, campusDeviceCount: 600 });

      const lot = makeLot({ current_occupancy: 100 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      expect(result.rawOccupancy).toBe(100);
      expect(result.estimatedOccupancy).toBeGreaterThan(100);
      expect(result.estimatedOccupancy).toBeLessThanOrEqual(1000);
      expect(result.effectiveRate).toBeGreaterThan(0);
    });

    it('applies activity cap when few devices are active', async () => {
      // 30 campus devices → max scaling = 2×
      // 30/35000 = 0.000857 rate, but scaling capped at 2×
      // effective rate = max(0.000857, 0.01, 0.01) = 0.01 → scaling 100
      // capped to 2× → 100 * 2 = 200
      setupMocks({ commuters: 35_000, campusDeviceCount: 30 });

      const lot = makeLot({ current_occupancy: 100 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      expect(result.estimatedOccupancy).toBe(200); // 100 * 2 cap
    });

    it('never exceeds lot capacity', async () => {
      setupMocks({ commuters: 35_000, campusDeviceCount: 600 });

      const lot = makeLot({ current_occupancy: 900, capacity: 1000 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      expect(result.estimatedOccupancy).toBeLessThanOrEqual(1000);
    });

    it('never drops below raw occupancy', async () => {
      // Even with a very high penetration rate (e.g. lot pen rate = 1.0)
      setupMocks();

      const lot = makeLot({ current_occupancy: 100, penetration_rate: 1.0 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      expect(result.estimatedOccupancy).toBeGreaterThanOrEqual(100);
    });

    it('applies closure multiplier during campus closure', async () => {
      // During closure: timeMultiplier = 0.02
      // adjustedCommuters = round(35000 * 0.02) = 700
      // 200 campus devices / 700 = 0.2857 rate
      // effective = max(0.2857, 0.01, 0.01) = 0.2857
      // scaling = 1/0.2857 = 3.5, capped at 5 (200 devices)
      // estimatedOccupancy = round(100 * 3.5) = 350
      setupMocks({ commuters: 35_000, closure: true, campusDeviceCount: 200 });

      const lot = makeLot({ current_occupancy: 100 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      expect(result.estimatedOccupancy).toBe(350);
    });

    it('rounds effectiveRate to 4 decimal places', async () => {
      setupMocks({ commuters: 35_000, campusDeviceCount: 100 });

      const lot = makeLot({ current_occupancy: 50 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      // effectiveRate should have at most 4 decimal places
      const decimalStr = result.effectiveRate.toString().split('.')[1] || '';
      expect(decimalStr.length).toBeLessThanOrEqual(4);
    });

    it('uses lot penetration_rate when it is higher than campus rate', async () => {
      // 100 campus devices / 35000 = 0.00286 campus rate
      // lot penetration_rate = 0.5 → effective = max(0.00286, 0.5, 0.01) = 0.5
      // scaling = 1/0.5 = 2, capped at 5 (100 devices)
      // estimatedOccupancy = round(100 * 2) = 200
      setupMocks({ commuters: 35_000, campusDeviceCount: 100 });

      const lot = makeLot({ current_occupancy: 100, penetration_rate: 0.5 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      expect(result.effectiveRate).toBe(0.5);
      expect(result.estimatedOccupancy).toBe(200);
    });

    it('reduces estimated occupancy during weekend', async () => {
      // Saturday day: timeMultiplier = 0.15
      // adjustedCommuters = round(35000 * 0.15) = 5250
      // 100 devices / 5250 = 0.01905
      // effective = max(0.01905, 0.01, 0.01) = 0.01905
      // scaling = 1/0.01905 = 52.5, capped at 5 (100 devices)
      // estimatedOccupancy = round(100 * 5) = 500
      setupMocks({ commuters: 35_000, campusDeviceCount: 100 });

      const lot = makeLot({ current_occupancy: 100 });
      const result = await service.estimateForLot(lot, SATURDAY_DAY);

      expect(result.estimatedOccupancy).toBe(500);
    });

    it('uses MIN_PENETRATION_RATE when all rates are very low', async () => {
      // 0 campus devices → campusRate = 0, lot pen = 0.005
      // effective = max(0, 0.005, 0.01) = 0.01
      // scaling = 100, capped at 2 (0 devices)
      // estimatedOccupancy = min(100 * 2, 1000) = 200
      setupMocks();

      const lot = makeLot({ current_occupancy: 100, penetration_rate: 0.005 });
      const result = await service.estimateForLot(lot, WEEKDAY_PEAK);

      expect(result.effectiveRate).toBe(0.01);
      expect(result.estimatedOccupancy).toBe(200); // capped at 2× with 0 devices
    });
  });

  // ─── estimateForAllLots ───────────────────────────────

  describe('estimateForAllLots', () => {
    it('returns empty map for empty lot list', async () => {
      const result = await service.estimateForAllLots([], WEEKDAY_PEAK);
      expect(result.size).toBe(0);
    });

    it('estimates for multiple lots sharing campus-wide data', async () => {
      prisma.academicCalendar.findFirst.mockResolvedValue({
        period_name: 'Spring 2026',
        expected_commuters: 35_000,
      });
      prisma.campusClosure.findFirst.mockResolvedValue(null);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(100) }]);

      const lots = [
        makeLot({ id: 'lot-1', current_occupancy: 100, capacity: 1000 }),
        makeLot({ id: 'lot-2', current_occupancy: 50, capacity: 500 }),
      ];

      const result = await service.estimateForAllLots(lots, WEEKDAY_PEAK);

      expect(result.size).toBe(2);
      expect(result.get('lot-1')).toBeDefined();
      expect(result.get('lot-2')).toBeDefined();

      // Both should share the same campus device count
      expect(result.get('lot-1')!.campusDevices).toBe(100);
      expect(result.get('lot-2')!.campusDevices).toBe(100);
    });

    it('applies floor for lots with zero occupancy during peak', async () => {
      prisma.academicCalendar.findFirst.mockResolvedValue({
        period_name: 'Spring 2026',
        expected_commuters: 35_000,
      });
      prisma.campusClosure.findFirst.mockResolvedValue(null);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(0) }]);

      const lots = [makeLot({ current_occupancy: 0, capacity: 1000 })];
      const result = await service.estimateForAllLots(lots, WEEKDAY_PEAK);

      const estimate = result.get('lot-1')!;
      expect(estimate.rawOccupancy).toBe(0);
      // floor = floor(1000 × 0.15 × 1.0) = 150
      expect(estimate.estimatedOccupancy).toBe(150);
      expect(estimate.effectiveRate).toBe(1);
      expect(estimate.isClosure).toBe(false);
    });

    it('queries academic calendar only once for the batch', async () => {
      prisma.academicCalendar.findFirst.mockResolvedValue({
        period_name: 'Spring 2026',
        expected_commuters: 35_000,
      });
      prisma.campusClosure.findFirst.mockResolvedValue(null);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ count: BigInt(0) }]);

      const lots = [
        makeLot({ id: 'lot-1', current_occupancy: 10 }),
        makeLot({ id: 'lot-2', current_occupancy: 20 }),
      ];

      await service.estimateForAllLots(lots, WEEKDAY_PEAK);

      // Academic calendar should be queried once (not once per lot)
      expect(prisma.academicCalendar.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
