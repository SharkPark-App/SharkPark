import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { Prisma } from '@prisma/client';
import type { Lot } from '@prisma/client';
import {
  getExpectedCommuters as calendarGetExpectedCommuters,
  isCampusOpen as calendarIsCampusOpen,
} from './academic-calendar';
import { TtlCache } from '../common/ttl-cache';

// ─── Types ─────────────────────────────────────────────────

export interface PenetrationEstimate {
  /** Effective penetration rate used for this lot (0.01–1.0) */
  effectiveRate: number;
  /** Raw device count (current_occupancy in DB) */
  rawOccupancy: number;
  /** Scaled-up estimate clamped to [rawOccupancy, capacity] */
  estimatedOccupancy: number;
  /** estimatedOccupancy / capacity */
  estimatedRate: number;
  /** Campus-wide active devices in the observation window */
  campusDevices: number;
  /** Adjusted expected commuters (after time-of-day + calendar) */
  adjustedCommuters: number;
  /** Whether the campus is on a closure day */
  isClosure: boolean;
}

// ─── Constants ─────────────────────────────────────────────

/** Hard floor — prevents divide-by-zero and absurd inflation */
const MIN_PENETRATION_RATE = 0.01;

/** How far back to count active devices (milliseconds) */
const DEVICE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Time-of-day multipliers applied to the academic period's expected_commuters.
 * Indexed by (isWeekend, hourBucket).
 */
const TIME_MULTIPLIERS: Record<string, number> = {
  // Weekday
  'wd_peak':    1.0,   // 7 AM – 6 PM
  'wd_evening': 0.35,  // 6 PM – 10 PM
  'wd_night':   0.05,  // 10 PM – 7 AM
  // Saturday
  'sat_day':    0.15,  // 8 AM – 6 PM
  'sat_other':  0.05,  // outside 8–6
  // Sunday
  'sun':        0.05,  // all day
};

/**
 * Activity-based scaling caps — when there are very few devices campus-wide,
 * we trust the raw numbers more and limit how much we scale up.
 * Hard ceiling of 20× even at high activity prevents impossible occupancy values.
 */
const SCALING_CAPS: { threshold: number; maxScaling: number }[] = [
  { threshold: 500, maxScaling: 20 },
  { threshold: 200, maxScaling: 10 },
  { threshold: 50,  maxScaling: 5 },
  { threshold: 0,   maxScaling: 2 },
];

/**
 * Campus closure multiplier — near-zero when campus is officially closed.
 */
const CLOSURE_MULTIPLIER = 0.02;

/**
 * Minimum occupancy floor (fraction of capacity) applied to lots with zero
 * device events during active campus hours.  Prevents showing 0% for lots
 * that simply lack app users but are certainly occupied.
 */
const MIN_FLOOR_RATE = 0.15;

/**
 * Time-of-day multiplier threshold below which the floor is not applied.
 * Matches wd_night / sun / sat_other — when the campus is genuinely quiet.
 */
const FLOOR_TIME_THRESHOLD = 0.10;

// ─── Service ───────────────────────────────────────────────

/**
 * Estimates the penetration rate (fraction of commuters using the app) and
 * scales raw occupancy counts up to approximate true lot occupancy.
 *
 * Three-layer approach:
 *  1. Academic calendar — base expected commuters for the current period
 *  2. Time-of-day + campus closures — adjust commuters for current conditions
 *  3. Activity-based cap — prevent over-scaling when campus is quiet
 */
@Injectable()
export class PenetrationEstimationService {
  private readonly logger = new Logger(PenetrationEstimationService.name);
  private readonly timezoneCache = new TtlCache<string>(5 * 60 * 1000); // 5 min
  private readonly deviceCountCache = new TtlCache<number>(2 * 60 * 1000); // 2 min

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estimates occupancy for a single lot.
   * @param lot  The Prisma Lot row (must include current_occupancy, capacity)
   * @param now  Optional override for current time (useful for testing)
   */
  async estimateForLot(lot: Lot, now: Date = new Date()): Promise<PenetrationEstimate> {
    const rawOccupancy = lot.current_occupancy;

    // Convert to school time for calendar and time-of-day calculations
    const schoolTz = await this.getSchoolTimezone(lot.school_id);
    const schoolTime = this.toSchoolTime(now, schoolTz);

    // Layer 1: Academic calendar — base expected commuters
    const baseCommuters = this.getExpectedCommuters(schoolTime);

    // Layer 2: Time-of-day + campus closure adjustments
    const isClosure = this.isCampusClosure(schoolTime);
    const timeMultiplier = isClosure ? CLOSURE_MULTIPLIER : this.getTimeMultiplier(schoolTime);
    const adjustedCommuters = Math.max(1, Math.round(baseCommuters * timeMultiplier));

    // Count campus-wide active devices
    const campusDevices = await this.countCampusDevices(lot.school_id, now);

    // ── Empty-lot floor ──────────────────────────────────────
    // During active campus hours, lots with 0 device events still get a
    // minimum estimate proportional to their capacity — students park there
    // even if none use the app.
    if (rawOccupancy <= 0) {
      const floor = this.computeFloor(lot.capacity, timeMultiplier, isClosure);
      return {
        effectiveRate: 1,
        rawOccupancy: 0,
        estimatedOccupancy: floor,
        estimatedRate: lot.capacity > 0 ? Math.round((floor / lot.capacity) * 1000) / 1000 : 0,
        campusDevices,
        adjustedCommuters,
        isClosure,
      };
    }

    // Compute penetration rate
    const campusRate = campusDevices > 0 ? campusDevices / adjustedCommuters : 0;

    // Use the most conservative (highest) rate — lowest estimate.
    // Per-lot floor was dropped (was never auto-updated and only ever a fossil
    // from before the campus-wide rate existed); rely on MIN_PENETRATION_RATE.
    const effectiveRate = Math.max(campusRate, MIN_PENETRATION_RATE);

    // Determine scaling cap based on campus activity
    const maxScaling = this.getMaxScaling(campusDevices);

    // Apply scaling with cap
    const rawScaling = 1 / effectiveRate;
    const cappedScaling = Math.min(rawScaling, maxScaling);
    const scaledOccupancy = Math.round(rawOccupancy * cappedScaling);

    // Clamp: never below raw, never above capacity
    const estimatedOccupancy = Math.max(rawOccupancy, Math.min(scaledOccupancy, lot.capacity));
    const estimatedRate = lot.capacity > 0 ? estimatedOccupancy / lot.capacity : 0;

    return {
      effectiveRate: Math.round(effectiveRate * 10000) / 10000,
      rawOccupancy,
      estimatedOccupancy,
      estimatedRate: Math.round(estimatedRate * 1000) / 1000,
      campusDevices,
      adjustedCommuters,
      isClosure,
    };
  }

  /**
   * Batch estimation for all lots (used by snapshot job and findAll).
   * Queries campus-wide data once and reuses it.
   */
  async estimateForAllLots(lots: Lot[], now: Date = new Date()): Promise<Map<string, PenetrationEstimate>> {
    const results = new Map<string, PenetrationEstimate>();

    if (lots.length === 0) return results;

    // All lots belong to the same school in our current setup
    const schoolId = lots[0].school_id;

    // Shared queries — DB for devices+timezone; calendar module for the rest
    const [campusDevices, schoolTz] = await Promise.all([
      this.countCampusDevices(schoolId, now),
      this.getSchoolTimezone(schoolId),
    ]);

    const schoolTime = this.toSchoolTime(now, schoolTz);
    const baseCommuters = this.getExpectedCommuters(schoolTime);
    const isClosure = this.isCampusClosure(schoolTime);
    const timeMultiplier = isClosure ? CLOSURE_MULTIPLIER : this.getTimeMultiplier(schoolTime);
    const adjustedCommuters = Math.max(1, Math.round(baseCommuters * timeMultiplier));
    const campusRate = campusDevices > 0 ? campusDevices / adjustedCommuters : 0;
    const maxScaling = this.getMaxScaling(campusDevices);

    for (const lot of lots) {
      if (lot.current_occupancy <= 0) {
        const floor = this.computeFloor(lot.capacity, timeMultiplier, isClosure);
        results.set(lot.id, {
          effectiveRate: 1,
          rawOccupancy: 0,
          estimatedOccupancy: floor,
          estimatedRate: lot.capacity > 0 ? Math.round((floor / lot.capacity) * 1000) / 1000 : 0,
          campusDevices,
          adjustedCommuters,
          isClosure,
        });
        continue;
      }

      const effectiveRate = Math.max(campusRate, MIN_PENETRATION_RATE);
      const rawScaling = 1 / effectiveRate;
      const cappedScaling = Math.min(rawScaling, maxScaling);
      const scaledOccupancy = Math.round(lot.current_occupancy * cappedScaling);
      const estimatedOccupancy = Math.max(lot.current_occupancy, Math.min(scaledOccupancy, lot.capacity));
      const estimatedRate = lot.capacity > 0 ? estimatedOccupancy / lot.capacity : 0;

      results.set(lot.id, {
        effectiveRate: Math.round(effectiveRate * 10000) / 10000,
        rawOccupancy: lot.current_occupancy,
        estimatedOccupancy,
        estimatedRate: Math.round(estimatedRate * 1000) / 1000,
        campusDevices,
        adjustedCommuters,
        isClosure,
      });
    }

    return results;
  }

  // ─── Empty-Lot Floor ─────────────────────────────────────

  /**
   * Computes a minimum occupancy estimate for lots with zero device events.
   * Applied only during active campus hours (time multiplier above threshold
   * and campus is not on a closure day).
   *
   * Formula: floor(capacity × MIN_FLOOR_RATE × timeMultiplier)
   * → e.g. 1,000-space lot at weekday peak: 1000 × 0.15 × 1.0 = 150
   * → same lot Saturday afternoon: 1000 × 0.15 × 0.15 = 22
   */
  computeFloor(capacity: number, timeMultiplier: number, isClosure: boolean): number {
    if (isClosure || timeMultiplier < FLOOR_TIME_THRESHOLD) return 0;
    return Math.floor(capacity * MIN_FLOOR_RATE * timeMultiplier);
  }

  // ─── Layer 1: Academic Calendar ──────────────────────────

  /**
   * Returns the expected_commuters for the academic period containing `date`.
   * Accepts a school-local Date (call toSchoolTime first).
   */
  getExpectedCommuters(schoolTime: Date): number {
    return calendarGetExpectedCommuters(schoolTime);
  }

  // ─── Layer 2: Time & Closures ────────────────────────────

  /**
   * Returns the IANA timezone string for a school (e.g. "America/Los_Angeles").
   * Falls back to America/Los_Angeles if not found.
   */
  async getSchoolTimezone(schoolId: string): Promise<string> {
    const cached = this.timezoneCache.get(schoolId);
    if (cached !== undefined) return cached;

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const tz = school?.timezone ?? 'America/Los_Angeles';
    this.timezoneCache.set(schoolId, tz);
    return tz;
  }

  /**
   * Converts a UTC Date to a Date whose getDay()/getHours() return values
   * in the school's local timezone.
   */
  toSchoolTime(date: Date, timezone: string): Date {
    const localeStr = date.toLocaleString('en-US', { timeZone: timezone });
    return new Date(localeStr);
  }

  /**
   * Returns a multiplier (0–1) for the given time based on day-of-week and hour.
   * Expects a Date already converted to the school's local timezone.
   */
  getTimeMultiplier(date: Date): number {
    const day = date.getDay(); // 0 = Sunday
    const hour = date.getHours();

    if (day === 0) return TIME_MULTIPLIERS['sun'];

    if (day === 6) {
      // Saturday
      return (hour >= 8 && hour < 18)
        ? TIME_MULTIPLIERS['sat_day']
        : TIME_MULTIPLIERS['sat_other'];
    }

    // Weekday (Mon–Fri)
    if (hour >= 7 && hour < 18) return TIME_MULTIPLIERS['wd_peak'];
    if (hour >= 18 && hour < 22) return TIME_MULTIPLIERS['wd_evening'];
    return TIME_MULTIPLIERS['wd_night'];
  }

  /**
   * Checks whether the given date falls on a campus closure.
   * Accepts a school-local Date (call toSchoolTime first).
   */
  isCampusClosure(schoolTime: Date): boolean {
    return !calendarIsCampusOpen(schoolTime);
  }

  // ─── Layer 3: Activity-Based Cap ─────────────────────────

  /**
   * Counts unique active devices campus-wide in the observation window.
   * Uses raw SQL COUNT(DISTINCT) to avoid loading event rows into memory.
   */
  async countCampusDevices(schoolId: string, now: Date): Promise<number> {
    const cacheKey = schoolId;
    const cached = this.deviceCountCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const windowStart = new Date(now.getTime() - DEVICE_WINDOW_MS);

    const result = await this.prisma.$queryRaw<[{ count: bigint }]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT oe.device_hash) AS count
        FROM occupancy_events oe
        JOIN lots l ON l.id = oe.lot_id
        WHERE l.school_id = ${schoolId}
          AND oe.timestamp >= ${windowStart}
          AND oe.timestamp <= ${now}
      `,
    );

    const count = Number(result[0]?.count ?? 0);
    this.deviceCountCache.set(cacheKey, count);
    return count;
  }

  /**
   * Returns the maximum scaling factor based on campus-wide device activity.
   * Fewer devices → lower cap → trust raw numbers more.
   */
  getMaxScaling(campusDevices: number): number {
    for (const cap of SCALING_CAPS) {
      if (campusDevices >= cap.threshold) {
        return cap.maxScaling;
      }
    }
    return 2; // fallback
  }
}
