import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { LotType, Prisma } from '@prisma/client';
import type { ParkingLotResponse, GetLotsQueryParams, OccupancySnapshotResponse, LotRecommendation, TrendPoint, LotUtilization } from './interfaces/parking-lot.interface';
import { PenetrationEstimationService, PenetrationEstimate } from './penetration-estimation.service';
import { WeatherService } from '../weather/weather.service';
import { OCCUPANCY_THRESHOLDS } from '../constants';
import { studentEligibleLotTypes } from './csulb-eligibility';
import { polygonToPolygonMeters } from './derive-lot-buildings';

/** Shape of `Lot.geofence_polygon` rows in the DB (stored as Prisma Json). */
type LatLng = { lat: number; lng: number };

const LOT_WITH_BUILDINGS_INCLUDE = {
  lot_buildings: { include: { building: { select: { name: true, category: true } } } },
  // Only active advisories make it onto the response — historical/closed ones
  // remain in the table for audit but aren't user-facing.
  lot_advisories: {
    where: { is_active: true },
    orderBy: [{ severity: 'desc' as const }, { updated_at: 'desc' as const }],
    select: {
      id: true,
      title: true,
      description: true,
      severity: true,
      source: true,
      match_reason: true,
      starts_at: true,
      ends_at: true,
      updated_at: true,
    },
  },
} satisfies Prisma.LotInclude;

type LotWithBuildings = Prisma.LotGetPayload<{ include: typeof LOT_WITH_BUILDINGS_INCLUDE }>;

/**
 * Service for parking lot data access and business logic.
 * Queries PostgreSQL via Prisma for lot metadata and timeseries occupancy data.
 */
@Injectable()
export class LotsService {
  private readonly logger = new Logger(LotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly penetrationService: PenetrationEstimationService,
    private readonly weatherService: WeatherService,
  ) {}

  /**
   * Retrieves all parking lots, with optional filtering.
   * Prisma WHERE clauses replace client-side filtering from DynamoDB.
   *
   * `redactLive` strips live-occupancy fields from the response so non-
   * contributor callers see metadata only. Filters that depend on availability
   * (`min_available`, `available_only`) are silently ignored when redacting,
   * since the underlying value isn't visible to the caller anyway — returning
   * a filtered subset would leak the very signal we're hiding.
   */
  async findAll(
    query: GetLotsQueryParams = {},
    options: { redactLive?: boolean } = {},
  ): Promise<ParkingLotResponse[]> {
    const { redactLive = false } = options;
    try {
      const lots = await this.prisma.lot.findMany({
        where: {
          ...(query.type && { lot_type: query.type as LotType }),
          ...(query.permit_type && { permit_types: { has: query.permit_type } }),
          ...(query.daily_permit !== undefined && { daily_permit_allowed: query.daily_permit }),
          ...(query.ev_charging && { ev_charging_stations: { gt: 0 } }),
        },
        include: LOT_WITH_BUILDINGS_INCLUDE,
      });

      // Skip the (relatively expensive) penetration estimate entirely when
      // we're going to redact the result — the estimate would only feed the
      // fields we're about to null out.
      const estimates = redactLive
        ? new Map<string, PenetrationEstimate>()
        : await this.penetrationService.estimateForAllLots(lots);

      let responses = lots.map(lot => this.transformToResponse(lot, estimates.get(lot.id), { redactLive }));

      // Post-estimation filters — only meaningful when live data is visible.
      // For redacted callers we'd be filtering on a value we won't return,
      // which would leak occupancy through the result set's *cardinality*.
      if (!redactLive && query.min_available) {
        responses = responses.filter(r => (r.estimated_available ?? 0) >= query.min_available!);
      }

      if (!redactLive && query.available_only) {
        responses = responses.filter(r => (r.estimated_available ?? 0) > 0);
      }

      return responses;
    } catch (error) {
      this.logger.error('Failed to fetch parking lots', error);
      throw new InternalServerErrorException('Failed to fetch parking lots');
    }
  }

  async findOne(lotId: string, options: { redactLive?: boolean } = {}): Promise<ParkingLotResponse> {
    const { redactLive = false } = options;
    try {
      const lot = await this.prisma.lot.findFirst({
        where: { lot_id: lotId },
        include: LOT_WITH_BUILDINGS_INCLUDE,
      });

      if (!lot) {
        throw new NotFoundException(`Parking lot ${lotId} not found`);
      }

      const estimate = redactLive ? undefined : await this.penetrationService.estimateForLot(lot);
      return this.transformToResponse(lot, estimate, { redactLive });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch lot ${lotId}`, error);
      throw new InternalServerErrorException(`Failed to fetch parking lot ${lotId}`);
    }
  }

  /**
   * Retrieves historical occupancy snapshots for a specific lot and date.
   */
  async getHistory(
    lotId: string,
    date: string,
    limit: number = 96,
  ): Promise<OccupancySnapshotResponse[]> {
    try {
      // Find the lot's internal ID from the human-readable lot_id
      const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
      if (!lot) {
        throw new NotFoundException(`Parking lot ${lotId} not found`);
      }

      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      const snapshots = await this.prisma.occupancySnapshot.findMany({
        where: {
          lot_id: lot.id,
          timestamp: { gte: startOfDay, lte: endOfDay },
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return snapshots.map(s => ({
        lot_id: lotId,
        timestamp: s.timestamp.toISOString(),
        occupancy: s.occupancy,
        available: s.available,
        occupancy_rate: s.occupancy_rate,
        confidence: s.confidence,
      }));
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch history for lot ${lotId}`, error);
      throw new InternalServerErrorException(`Failed to fetch historical data for lot ${lotId}`);
    }
  }

  async getOccupancySummary(): Promise<{
    total_lots: number;
    total_capacity: number;
    total_occupied: number;
    total_available: number;
    overall_occupancy_rate: number;
    by_type: {
      STUDENT: { lots: number; capacity: number; occupied: number; available: number; occupancy_rate: number };
      EMPLOYEE: { lots: number; capacity: number; occupied: number; available: number; occupancy_rate: number };
    };
    high_occupancy_lots: ParkingLotResponse[];
    timestamp: string;
  }> {
    try {
      // Aggregate at the DB level — avoids fetching every lot row and transforming individually
      const groups = await this.prisma.lot.groupBy({
        by: ['lot_type'],
        _count: { id: true },
        _sum: { capacity: true, current_occupancy: true },
      });

      // Fetch all lots for penetration estimation (already batched in one call)
      const lots = await this.prisma.lot.findMany({ include: LOT_WITH_BUILDINGS_INCLUDE });
      const estimates = await this.penetrationService.estimateForAllLots(lots);

      let studentEstimated = 0;
      let employeeEstimated = 0;
      const responses: ParkingLotResponse[] = [];

      for (const lot of lots) {
        const est = estimates.get(lot.id);
        const occ = est ? est.estimatedOccupancy : lot.current_occupancy;
        if (lot.lot_type === 'STUDENT') studentEstimated += occ;
        else employeeEstimated += occ;
        responses.push(this.transformToResponse(lot, est));
      }

      const studentGroup = groups.find(g => g.lot_type === 'STUDENT');
      const employeeGroup = groups.find(g => g.lot_type === 'EMPLOYEE');

      const studentCapacity = studentGroup?._sum.capacity ?? 0;
      const employeeCapacity = employeeGroup?._sum.capacity ?? 0;
      const totalCapacity = studentCapacity + employeeCapacity;
      const totalOccupied = studentEstimated + employeeEstimated;

      // Lots at or above NEARLY_FULL threshold. `occupancy_rate` is non-null
      // here because we never pass `redactLive` to transformToResponse on this
      // path (the summary endpoint is itself contributor-gated), but the
      // narrowing is local so we use `?? 0` for compile safety.
      const highOccupancyLots = responses
        .filter(r => (r.occupancy_rate ?? 0) >= OCCUPANCY_THRESHOLDS.NEARLY_FULL)
        .sort((a, b) => (b.occupancy_rate ?? 0) - (a.occupancy_rate ?? 0));

      return {
        total_lots: lots.length,
        total_capacity: totalCapacity,
        total_occupied: totalOccupied,
        total_available: totalCapacity - totalOccupied,
        overall_occupancy_rate: totalCapacity > 0
          ? Math.round((totalOccupied / totalCapacity) * 1000) / 1000
          : 0,
        by_type: {
          STUDENT: {
            lots: studentGroup?._count.id ?? 0,
            capacity: studentCapacity,
            occupied: studentEstimated,
            available: studentCapacity - studentEstimated,
            occupancy_rate: studentCapacity > 0
              ? Math.round((studentEstimated / studentCapacity) * 1000) / 1000
              : 0,
          },
          EMPLOYEE: {
            lots: employeeGroup?._count.id ?? 0,
            capacity: employeeCapacity,
            occupied: employeeEstimated,
            available: employeeCapacity - employeeEstimated,
            occupancy_rate: employeeCapacity > 0
              ? Math.round((employeeEstimated / employeeCapacity) * 1000) / 1000
              : 0,
          },
        },
        high_occupancy_lots: highOccupancyLots,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to calculate occupancy summary', error);
      throw new InternalServerErrorException('Failed to calculate occupancy summary');
    }
  }

  // ─── Recommendation Engine ───────────────────────────────

  /** Scoring weights for the recommendation algorithm */
  private static readonly RECOMMENDATION_WEIGHTS = {
    availability: 0.40,
    distance: 0.35,
    typeMatch: 0.15,
    permitCompat: 0.10,
  };

  /**
   * Maximum distance (meters) used to normalize distance scores. Lots beyond
   * this get 0. Sized to CSULB's ~1.3 × 1.5 km footprint: with polygon-edge
   * distance, anything past ~1 km between lots is effectively "drive, don't
   * walk" — not a meaningful walking alternative. A tighter ceiling here
   * makes the distance signal actually move scores (a 400 m gap is worth
   * ~14 points, not ~7) instead of being washed out by the campus diameter.
   */
  private static readonly MAX_DISTANCE_METERS = 1000;

  /** Occupancy rate threshold at which a lot is considered too full to recommend */
  private static readonly FULL_THRESHOLD = OCCUPANCY_THRESHOLDS.RECOMMENDATION_CUTOFF;

  /**
   * Recommends alternative lots when a preferred lot is full or nearly full.
   * Scores candidates using weighted factors: availability, distance, type match, permit compatibility.
   * Excludes the source lot and any lots at ≥75% occupancy.
   */
  async getRecommendations(lotId: string, limit: number = 5): Promise<LotRecommendation[]> {
    // Look up the source lot
    const sourceLot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
    if (!sourceLot) {
      throw new NotFoundException(`Parking lot ${lotId} not found`);
    }

    // Determine which lot types are eligible candidates.
    //   - STUDENT source: students can park in employee lots after 17:30 on
    //     weekdays and any time on weekends; outside that window they stay
    //     in STUDENT lots only (see csulb-eligibility.ts).
    //   - EMPLOYEE source: recommend other EMPLOYEE lots only. Employees
    //     are technically permitted in any lot, but suggesting a STUDENT lot
    //     to a faculty/staff member heading to their employee zone isn't a
    //     useful alternative — they'd be giving up their reserved access.
    const eligibleTypes: LotType[] = sourceLot.lot_type === 'STUDENT'
      ? Array.from(
          studentEligibleLotTypes(
            new Date(),
            await this.penetrationService.getSchoolTimezone(sourceLot.school_id),
          ),
        )
      : ['EMPLOYEE'];

    // Fetch all candidate lots within the eligible types.
    const candidates = await this.prisma.lot.findMany({
      where: {
        lot_type: { in: eligibleTypes },
        id: { not: sourceLot.id },
      },
      include: LOT_WITH_BUILDINGS_INCLUDE,
    });

    // Batch-estimate penetration for candidates
    const estimates = await this.penetrationService.estimateForAllLots(candidates);

    const W = LotsService.RECOMMENDATION_WEIGHTS;

    const scored = candidates
      .map(candidate => {
        const estimate = estimates.get(candidate.id);
        const response = this.transformToResponse(candidate, estimate);

        // Skip lots that are full (based on estimated occupancy). `redactLive`
        // is never passed on the recommendation path — the endpoint is
        // contributor-gated — so these are non-null in practice.
        if ((response.occupancy_rate ?? 0) >= LotsService.FULL_THRESHOLD) return null;

        // --- Availability score (0–1): higher = more space available ---
        const availabilityScore = candidate.capacity > 0
          ? (response.estimated_available ?? 0) / candidate.capacity
          : 0;

        // --- Distance score (0–1): closer = higher ---
        // Polygon-edge-to-polygon-edge using the lots' geofence outlines.
        // Centroid haversine over-states real walking distance for large or
        // irregular lots (PVN/PVS, the G6/G7 surface lots, the parking
        // structures). Edge-to-edge is the honest "shortest walk between
        // them" metric, with centroid fallback when a polygon is missing.
        const distance = polygonToPolygonMeters(
          (sourceLot.geofence_polygon ?? []) as LatLng[],
          (candidate.geofence_polygon ?? []) as LatLng[],
          { lat: sourceLot.center_lat, lng: sourceLot.center_lng },
          { lat: candidate.center_lat, lng: candidate.center_lng },
        );
        const distanceScore = Math.max(0, 1 - distance / LotsService.MAX_DISTANCE_METERS);

        // --- Type match (0 or 1) — already filtered to same type, so always 1 ---
        const typeScore = candidate.lot_type === sourceLot.lot_type ? 1 : 0;

        // --- Permit compatibility (0–1): fraction of source permits that the candidate also accepts ---
        const sourcePermits = new Set(sourceLot.permit_types);
        const overlap = candidate.permit_types.filter(p => sourcePermits.has(p)).length;
        const permitScore = sourcePermits.size > 0 ? overlap / sourcePermits.size : 1;

        const score = Math.round(
          (W.availability * availabilityScore +
            W.distance    * distanceScore +
            W.typeMatch   * typeScore +
            W.permitCompat * permitScore) * 100,
        );

        // Build a human-readable reason
        const reason = this.buildRecommendationReason(response, distance);

        return {
          ...response,
          recommendation_score: score,
          distance_meters: Math.round(distance),
          reason,
        } satisfies LotRecommendation;
      })
      .filter((entry): entry is LotRecommendation => entry !== null)
      .sort((a, b) => b.recommendation_score - a.recommendation_score)
      .slice(0, limit);

    return scored;
  }

  /**
   * Produces a short, user-friendly reason string for why a lot is recommended.
   */
  private buildRecommendationReason(
    lot: ParkingLotResponse,
    distanceMeters: number,
  ): string {
    const parts: string[] = [];

    if (lot.fill_status === 'AVAILABLE') {
      parts.push(`${lot.available} spots available`);
    } else if (lot.fill_status === 'FILLING') {
      parts.push(`${lot.available} spots left, filling up`);
    } else {
      parts.push(`${lot.available} spots remaining`);
    }

    if (distanceMeters < 300) {
      parts.push('very close by');
    } else if (distanceMeters < 600) {
      parts.push('nearby');
    } else {
      parts.push(`~${Math.round(distanceMeters / 100) * 100}m away`);
    }

    return parts.join(' · ');
  }

  /**
   * Returns hourly average occupancy for a single lot over the past N days.
   * Uses a raw GROUP BY date_trunc query since Prisma groupBy doesn't support
   * date truncation.
   *
   * Buckets are UTC: `date_trunc('hour', timestamp)` runs in the DB session
   * timezone, and Postgres on Neon is configured to UTC. Clients should
   * convert to local time for display.
   */
  async getTrends(lotId: string, rangeDays: number): Promise<TrendPoint[]> {
    try {
      const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
      if (!lot) throw new NotFoundException(`Parking lot ${lotId} not found`);

      const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

      const rows = await this.prisma.$queryRaw<Array<{
        hour: Date;
        avg_occupancy_rate: number;
        avg_occupancy: number;
        avg_available: number;
        avg_estimated_occupancy: number | null;
        avg_estimated_rate: number | null;
        sample_count: bigint;
      }>>`
        SELECT
          date_trunc('hour', timestamp) AS hour,
          ROUND(AVG(occupancy_rate)::numeric, 3)::float8           AS avg_occupancy_rate,
          ROUND(AVG(occupancy)::numeric, 1)::float8                AS avg_occupancy,
          ROUND(AVG(available)::numeric, 1)::float8                AS avg_available,
          ROUND(AVG(estimated_occupancy)::numeric, 1)::float8      AS avg_estimated_occupancy,
          ROUND((AVG(estimated_occupancy) / NULLIF(${lot.capacity}::float8, 0))::numeric, 3)::float8 AS avg_estimated_rate,
          COUNT(*)                                                 AS sample_count
        FROM occupancy_snapshots
        WHERE lot_id = ${lot.id} AND timestamp >= ${since}
        GROUP BY date_trunc('hour', timestamp)
        ORDER BY hour ASC
      `;

      return rows.map(r => ({
        hour: r.hour.toISOString(),
        avg_occupancy_rate: Number(r.avg_occupancy_rate),
        avg_occupancy: Number(r.avg_occupancy),
        avg_available: Number(r.avg_available),
        avg_estimated_occupancy:
          r.avg_estimated_occupancy != null ? Number(r.avg_estimated_occupancy) : null,
        avg_estimated_rate:
          r.avg_estimated_rate != null ? Number(r.avg_estimated_rate) : null,
        sample_count: Number(r.sample_count),
      }));
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Failed to fetch trends for lot ${lotId}`, error);
      throw new InternalServerErrorException(`Failed to fetch trends for lot ${lotId}`);
    }
  }

  /**
   * Returns per-lot average utilization over the past N days.
   *
   * Emits both the raw `avg_utilization` (device-coverage rate) and the
   * penetration-corrected `avg_estimated_utilization` (true fullness proxy).
   * Lots with no snapshots in the range get both averages as `null`; lots
   * that have only legacy snapshots written before the penetration rollout
   * keep `avg_utilization` populated and `avg_estimated_utilization` null.
   * Sort order prefers `avg_estimated_utilization` and falls back to the raw
   * rate so legacy rows still rank.
   */
  async getUtilization(rangeDays: number): Promise<LotUtilization[]> {
    try {
      const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

      const [lots, aggregates] = await Promise.all([
        this.prisma.lot.findMany({ orderBy: { lot_id: 'asc' } }),
        this.prisma.occupancySnapshot.groupBy({
          by: ['lot_id'],
          where: { timestamp: { gte: since } },
          _avg: { occupancy_rate: true, estimated_occupancy: true },
          _count: { id: true },
        }),
      ]);

      const aggMap = new Map(aggregates.map(a => [a.lot_id, a]));

      return lots
        .map(lot => {
          const agg = aggMap.get(lot.id);
          const rate = agg?._avg.occupancy_rate;
          const estOcc = agg?._avg.estimated_occupancy;
          const estRate =
            estOcc != null && lot.capacity > 0 ? estOcc / lot.capacity : null;
          return {
            lot_id: lot.lot_id,
            display_name: lot.display_name,
            lot_type: lot.lot_type as string,
            capacity: lot.capacity,
            avg_utilization: rate != null ? Math.round(rate * 1000) / 1000 : null,
            avg_estimated_utilization:
              estRate != null ? Math.round(estRate * 1000) / 1000 : null,
            snapshot_count: agg?._count.id ?? 0,
          };
        })
        // Sort by penetration-corrected utilization when available; fall back
        // to the raw rate so older lots without estimates still rank.
        .sort(
          (a, b) =>
            (b.avg_estimated_utilization ?? b.avg_utilization ?? -1) -
            (a.avg_estimated_utilization ?? a.avg_utilization ?? -1),
        );
    } catch (error) {
      this.logger.error('Failed to fetch lot utilization', error);
      throw new InternalServerErrorException('Failed to fetch lot utilization');
    }
  }

  /**
   * Parses a range string like "7d" or "30d" into a number of days.
   * Silently defaults when the format is unrecognised.
   */
  parseRangeDays(range: string | undefined, defaultDays: number, maxDays: number): number {
    if (!range) return defaultDays;
    const match = /^(\d+)d$/.exec(range);
    if (!match) return defaultDays;
    return Math.min(Math.max(1, parseInt(match[1], 10)), maxDays);
  }

  /**
   * Adds computed fields to parking lot data for client consumption.
   * When a PenetrationEstimate is provided, uses estimated occupancy for
   * availability, occupancy_rate, and fill_status calculations.
   */
  private transformToResponse(
    lot: LotWithBuildings,
    estimate?: PenetrationEstimate,
    options: { redactLive?: boolean } = {},
  ): ParkingLotResponse {
    const { redactLive = false } = options;

    // Strip Prisma `current_occupancy`, `daily_rate`, and the join relations from
    // the spread — we set them explicitly below so the type stays accurate.
    const { current_occupancy, daily_rate, lot_buildings, lot_advisories, ...meta } = lot;
    const buildings = lot_buildings.map(lb => ({
      name: lb.building.name,
      category: lb.building.category,
    }));
    // Coerce DateTime fields to ISO strings for transport. Advisories are
    // static metadata (not contributor-gated) — every caller, including App
    // Store reviewers, sees them so the UI can warn about closures even when
    // live occupancy is locked.
    const advisories = lot_advisories.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      severity: a.severity,
      source: a.source,
      match_reason: a.match_reason,
      starts_at: a.starts_at ? a.starts_at.toISOString() : null,
      ends_at: a.ends_at ? a.ends_at.toISOString() : null,
      updated_at: a.updated_at.toISOString(),
    }));

    if (redactLive) {
      return {
        ...meta,
        daily_rate: daily_rate != null ? Number(daily_rate) : null,
        current_occupancy: null,
        available: null,
        occupancy_rate: null,
        fill_status: null,
        estimated_occupancy: null,
        estimated_available: null,
        raw_occupancy: null,
        effective_penetration_rate: null,
        buildings,
        advisories,
      };
    }

    const rawOccupancy = current_occupancy;
    const estimatedOccupancy = estimate ? estimate.estimatedOccupancy : rawOccupancy;

    // `available` uses estimated occupancy — represents the best-guess true availability.
    // `estimated_available` is an explicit alias; both use the same estimated value.
    const available = lot.capacity - estimatedOccupancy;
    const occupancy_rate = lot.capacity > 0 ? estimatedOccupancy / lot.capacity : 0;

    let fill_status: 'AVAILABLE' | 'FILLING' | 'NEARLY_FULL' | 'FULL';
    if (occupancy_rate >= OCCUPANCY_THRESHOLDS.FULL) {
      fill_status = 'FULL';
    } else if (occupancy_rate >= OCCUPANCY_THRESHOLDS.NEARLY_FULL) {
      fill_status = 'NEARLY_FULL';
    } else if (occupancy_rate >= OCCUPANCY_THRESHOLDS.FILLING) {
      fill_status = 'FILLING';
    } else {
      fill_status = 'AVAILABLE';
    }

    return {
      ...meta,
      daily_rate: daily_rate != null ? Number(daily_rate) : null,
      current_occupancy: rawOccupancy,
      available: Math.max(0, available),
      occupancy_rate: Math.round(occupancy_rate * 1000) / 1000,
      fill_status,
      estimated_occupancy: estimatedOccupancy,
      estimated_available: Math.max(0, available),
      raw_occupancy: rawOccupancy,
      effective_penetration_rate: estimate
        ? Math.round(estimate.effectiveRate * 10000) / 10000
        : 1,
      buildings,
      advisories,
    };
  }

  /**
   * Fetches short-term ML predictions for a lot from predictions_short_term.
   * Includes current weather context.
   *
   * Note: campus events are intentionally NOT bundled here — per the 2026-04-30
   * product decision they are surfaced to the client as a separate display
   * layer (see `GET /lots/:id/nearby-events` on `LotsController`), not as a
   * forecasting input or a prediction-response field.
   */
  async getShortTermPredictions(lotId: string): Promise<{
    lot_id: string;
    predictions: Array<{
      target_time: string;
      predicted_occupancy: number;
      confidence_lower: number;
      confidence_upper: number;
      model_version: string;
    }>;
    weather: {
      conditions: string;
      temperature_f: number;
      is_raining: boolean;
      precipitation_probability: number;
    } | null;
  }> {
    const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
    if (!lot) throw new NotFoundException(`Lot ${lotId} not found`);

    // Grab predictions from the latest batch only. Filtering by predicted_at
    // (rather than target_time) avoids UTC-vs-campus-day boundary issues —
    // a single campus day's predictions span two UTC days (14:00Z..04:00Z+1
    // for 7 AM..9 PM PT), so a UTC-day filter on target_time would clip the
    // late-evening bars.
    const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Append-only table — dedupe to freshest prediction per target_time.
    const [predictions, weather] = await Promise.all([
      this.prisma.predictionShortTerm.findMany({
        where: {
          lot_id: lot.id,
          predicted_at: { gte: recentCutoff },
        },
        distinct: ['target_time'],
        orderBy: [{ target_time: 'asc' }, { predicted_at: 'desc' }],
        take: 20,
      }),
      this.weatherService.getCurrent(),
    ]);

    return {
      lot_id: lotId,
      predictions: predictions.map((p) => ({
        target_time: p.target_time.toISOString(),
        predicted_occupancy: p.predicted_occupancy,
        confidence_lower: p.confidence_lower,
        confidence_upper: p.confidence_upper,
        model_version: p.model_version,
      })),
      weather: weather
        ? {
            conditions: weather.conditions,
            temperature_f: weather.temperature_f,
            is_raining: weather.is_raining,
            precipitation_probability: weather.precipitation_probability,
          }
        : null,
    };
  }

  /**
   * Fetches long-term ML predictions for a lot from predictions_long_term.
   * Falls back to heuristic predictions based on historical snapshot averages
   * when ML predictions are unavailable.
   */
  async getLongTermPredictions(lotId: string, days = 7): Promise<{
    lot_id: string;
    source: 'ml' | 'heuristic';
    predictions: Array<{
      target_date: string;
      target_hour: number;
      predicted_occupancy: number;
      confidence_lower: number;
      confidence_upper: number;
      model_version: string;
    }>;
  }> {
    const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
    if (!lot) throw new NotFoundException(`Lot ${lotId} not found`);

    const now = new Date();
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Append-only table — dedupe to freshest prediction per (target_date, target_hour).
    const predictions = await this.prisma.predictionLongTerm.findMany({
      where: {
        lot_id: lot.id,
        target_date: { gte: now, lte: endDate },
      },
      distinct: ['target_date', 'target_hour'],
      orderBy: [
        { target_date: 'asc' },
        { target_hour: 'asc' },
        { predicted_at: 'desc' },
      ],
    });

    // If ML predictions exist, return them
    if (predictions.length > 0) {
      return {
        lot_id: lotId,
        source: 'ml',
        predictions: predictions.map((p) => ({
          target_date: p.target_date.toISOString().split('T')[0],
          target_hour: p.target_hour,
          predicted_occupancy: p.predicted_occupancy,
          confidence_lower: p.confidence_lower,
          confidence_upper: p.confidence_upper,
          model_version: p.model_version,
        })),
      };
    }

    // Fallback: generate heuristic predictions from historical snapshot averages
    return {
      lot_id: lotId,
      source: 'heuristic',
      predictions: this.generateHeuristicPredictions(days, now),
    };
  }

  /**
   * Generates heuristic long-term predictions based on typical campus parking patterns.
   * Provides useful predictions even before the ML model is trained.
   */
  private generateHeuristicPredictions(
    days: number,
    startDate: Date,
  ): Array<{
    target_date: string;
    target_hour: number;
    predicted_occupancy: number;
    confidence_lower: number;
    confidence_upper: number;
    model_version: string;
  }> {
    const predictions: Array<{
      target_date: string;
      target_hour: number;
      predicted_occupancy: number;
      confidence_lower: number;
      confidence_upper: number;
      model_version: string;
    }> = [];

    // Campus operating hours (6 AM - 10 PM)
    const CAMPUS_OPEN = 6;
    const CAMPUS_CLOSE = 22;

    // Typical occupancy patterns by hour (fraction of capacity)
    const hourlyPattern: Record<number, number> = {
      6: 0.10, 7: 0.25, 8: 0.50, 9: 0.70, 10: 0.80,
      11: 0.85, 12: 0.82, 13: 0.78, 14: 0.75, 15: 0.65,
      16: 0.55, 17: 0.45, 18: 0.35, 19: 0.25, 20: 0.15,
      21: 0.10,
    };

    for (let d = 0; d < days; d++) {
      const date = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      // Weekend multiplier: ~30% of weekday occupancy
      const dayMultiplier = isWeekend ? 0.30 : 1.0;

      const dateStr = date.toISOString().split('T')[0];

      for (let hour = CAMPUS_OPEN; hour < CAMPUS_CLOSE; hour++) {
        const baseRate = (hourlyPattern[hour] ?? 0.10) * dayMultiplier;

        // Wider confidence intervals for heuristic predictions
        const margin = 0.12;

        predictions.push({
          target_date: dateStr,
          target_hour: hour,
          // baseRate is bounded by hourlyPattern (max 0.85) * dayMultiplier (max 1.0),
          // so it can never exceed 1; no upper clamp needed here.
          predicted_occupancy: baseRate,
          confidence_lower: Math.max(0, baseRate - margin),
          confidence_upper: Math.min(1, baseRate + margin),
          model_version: 'heuristic-v1',
        });
      }
    }

    return predictions;
  }
}

