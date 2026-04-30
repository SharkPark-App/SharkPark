import { Injectable, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { Lot, LotType } from '@prisma/client';
import type { ParkingLotResponse, GetLotsQueryParams, OccupancySnapshotResponse, LotRecommendation } from './interfaces/parking-lot.interface';
import { PenetrationEstimationService, PenetrationEstimate } from './penetration-estimation.service';
import { WeatherService } from '../weather/weather.service';
import { OCCUPANCY_THRESHOLDS } from '../constants';

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
   */
  async findAll(query: GetLotsQueryParams = {}): Promise<ParkingLotResponse[]> {
    try {
      const lots = await this.prisma.lot.findMany({
        where: {
          ...(query.type && { lot_type: query.type as LotType }),
          ...(query.permit_type && { permit_types: { has: query.permit_type } }),
          ...(query.daily_permit !== undefined && { daily_permit_allowed: query.daily_permit }),
          ...(query.ev_charging && { ev_charging_stations: { gt: 0 } }),
        },
      });

      // Batch-estimate penetration for all lots at once (single set of DB queries)
      const estimates = await this.penetrationService.estimateForAllLots(lots);

      // Transform to responses first so filters can use estimated values
      let responses = lots.map(lot => this.transformToResponse(lot, estimates.get(lot.id)));

      // Post-estimation filters — use estimated availability for accuracy
      if (query.min_available) {
        responses = responses.filter(r => r.estimated_available >= query.min_available!);
      }

      if (query.available_only) {
        responses = responses.filter(r => r.estimated_available > 0);
      }

      return responses;
    } catch (error) {
      this.logger.error('Failed to fetch parking lots', error);
      throw new InternalServerErrorException('Failed to fetch parking lots');
    }
  }

  async findOne(lotId: string): Promise<ParkingLotResponse> {
    try {
      const lot = await this.prisma.lot.findFirst({
        where: { lot_id: lotId },
      });

      if (!lot) {
        throw new NotFoundException(`Parking lot ${lotId} not found`);
      }

      return this.transformToResponse(lot, await this.penetrationService.estimateForLot(lot));
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
      const lots = await this.prisma.lot.findMany();
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

      // Lots at or above NEARLY_FULL threshold
      const highOccupancyLots = responses
        .filter(r => r.occupancy_rate >= OCCUPANCY_THRESHOLDS.NEARLY_FULL)
        .sort((a, b) => b.occupancy_rate - a.occupancy_rate);

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

  /** Maximum distance (meters) used to normalize distance scores. Lots beyond this get 0. */
  private static readonly MAX_DISTANCE_METERS = 2000;

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

    // Fetch all lots of the same type (students shouldn't see employee lots and vice versa)
    const candidates = await this.prisma.lot.findMany({
      where: {
        lot_type: sourceLot.lot_type,
        id: { not: sourceLot.id },
      },
    });

    // Batch-estimate penetration for candidates
    const estimates = await this.penetrationService.estimateForAllLots(candidates);

    const W = LotsService.RECOMMENDATION_WEIGHTS;

    const scored = candidates
      .map(candidate => {
        const estimate = estimates.get(candidate.id);
        const response = this.transformToResponse(candidate, estimate);

        // Skip lots that are full (based on estimated occupancy)
        if (response.occupancy_rate >= LotsService.FULL_THRESHOLD) return null;

        // --- Availability score (0–1): higher = more space available ---
        const availabilityScore = candidate.capacity > 0
          ? response.estimated_available / candidate.capacity
          : 0;

        // --- Distance score (0–1): closer = higher ---
        const distance = this.haversineDistance(
          sourceLot.center_lat, sourceLot.center_lng,
          candidate.center_lat, candidate.center_lng,
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
   * Haversine formula — returns distance between two lat/lng points in meters.
   */
  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const EARTH_RADIUS = 6_371_000; // meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS * c;
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
   * Adds computed fields to parking lot data for client consumption.
   * When a PenetrationEstimate is provided, uses estimated occupancy for
   * availability, occupancy_rate, and fill_status calculations.
   */
  private transformToResponse(lot: Lot, estimate?: PenetrationEstimate): ParkingLotResponse {
    const rawOccupancy = lot.current_occupancy;
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
      ...lot,
      available: Math.max(0, available),
      occupancy_rate: Math.round(occupancy_rate * 1000) / 1000,
      fill_status,
      estimated_occupancy: estimatedOccupancy,
      estimated_available: Math.max(0, available),
      raw_occupancy: rawOccupancy,
      effective_penetration_rate: estimate
        ? Math.round(estimate.effectiveRate * 10000) / 10000
        : 1,
    };
  }

  /**
   * Fetches short-term ML predictions for a lot from predictions_short_term.
   * Includes current weather context.
   *
   * Note: campus events are intentionally NOT bundled here — per the 2026-04-30
   * product decision they are surfaced to the client as a separate display
   * layer (see the planned `GET /lots/:id/nearby-events` endpoint), not as a
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

    const now = new Date();

    const [predictions, weather] = await Promise.all([
      this.prisma.predictionShortTerm.findMany({
        where: {
          lot_id: lot.id,
          target_time: { gte: now },
        },
        orderBy: { target_time: 'asc' },
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

    const predictions = await this.prisma.predictionLongTerm.findMany({
      where: {
        lot_id: lot.id,
        target_date: { gte: now, lte: endDate },
      },
      orderBy: [{ target_date: 'asc' }, { target_hour: 'asc' }],
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
      predictions: this.generateHeuristicPredictions(lot, days, now),
    };
  }

  /**
   * Generates heuristic long-term predictions based on typical campus parking patterns.
   * Provides useful predictions even before the ML model is trained.
   */
  private generateHeuristicPredictions(
    lot: Lot,
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
        const predicted = Math.round(baseRate * lot.capacity);

        // Wider confidence intervals for heuristic predictions
        const margin = Math.round(lot.capacity * 0.12);

        predictions.push({
          target_date: dateStr,
          target_hour: hour,
          predicted_occupancy: Math.min(predicted, lot.capacity),
          confidence_lower: Math.max(0, predicted - margin),
          confidence_upper: Math.min(lot.capacity, predicted + margin),
          model_version: 'heuristic-v1',
        });
      }
    }

    return predictions;
  }
}

