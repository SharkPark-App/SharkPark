import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { ReliabilityService } from './reliability.service';
import {
  ReliabilityScore,
  ReliabilityScoreSummary,
  ReliabilityInput,
  ReliabilityThresholds,
} from './interfaces';

@Injectable()
export class ReliabilityComputationService {
  private readonly logger = new Logger(ReliabilityComputationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reliabilityService: ReliabilityService,
  ) {}

  async computeReliabilityForLot(
    lotId: string,
    thresholds: ReliabilityThresholds = this.reliabilityService.getDefaultThresholds(),
  ): Promise<ReliabilityScore> {
    const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
    if (!lot) {
      throw new NotFoundException(`Lot ${lotId} not found`);
    }

    const input = await this.gatherReliabilityInput(lot, thresholds);
    return this.reliabilityService.computeReliability(lotId, input, undefined, thresholds);
  }

  async computeReliabilityForAllLots(): Promise<ReliabilityScoreSummary[]> {
    const lots = await this.prisma.lot.findMany();
    const inputsByLotId = await this.gatherReliabilityInputsBatch(lots);
    const results: ReliabilityScoreSummary[] = [];

    for (const lot of lots) {
      const input = inputsByLotId.get(lot.lot_id);
      if (!input) {
        this.logger.warn(`Missing batched reliability input for lot ${lot.lot_id}`);
        results.push({
          lotId: lot.lot_id,
          score: 0,
          confidence: 'LOW',
          isColdStart: true,
          computedAt: new Date().toISOString(),
        });
        continue;
      }

      try {
        results.push(
          this.reliabilityService.computeReliabilitySummary(lot.lot_id, input),
        );
      } catch (error) {
        this.logger.warn(
          `Failed to compute reliability for lot ${lot.lot_id}`,
          error,
        );
        results.push({
          lotId: lot.lot_id,
          score: 0,
          confidence: 'LOW',
          isColdStart: true,
          computedAt: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Batch variant of gatherReliabilityInput: runs four queries total. 
   */
  private async gatherReliabilityInputsBatch(
    lots: Array<{ id: string; lot_id: string; penetration_rate: number }>,
    thresholds: ReliabilityThresholds = this.reliabilityService.getDefaultThresholds(),
  ): Promise<Map<string, ReliabilityInput>> {
    const result = new Map<string, ReliabilityInput>();
    if (lots.length === 0) return result;
    
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const reportsWindowStart = new Date(
      now.getTime() - thresholds.userReportsWindowMinutes * 60 * 1000,
    );
    const lotIds = lots.map((l) => l.id);
    
    const [events, reporterRows, predictions, snapshots] = await Promise.all([
      this.prisma.occupancyEvent.findMany({
        where: { lot_id: { in: lotIds }, timestamp: { gte: twoHoursAgo, lte: now } },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.report.groupBy({
        by: ['lot_id', 'user_id'],
        where: {
          lot_id: { in: lotIds },
          created_at: { gte: reportsWindowStart, lte: now },
        },
      }),
      this.prisma.predictionShortTerm.findMany({
        where: { lot_id: { in: lotIds }, target_time: { gte: sevenDaysAgo, lte: now } },
        orderBy: { target_time: 'asc' },
      }),
      this.prisma.occupancySnapshot.findMany({
        where: {
          lot_id: { in: lotIds },
          timestamp: {
            gte: new Date(sevenDaysAgo.getTime() - 10 * 60 * 1000),
            lte: new Date(now.getTime() + 10 * 60 * 1000),
          },
        },
        orderBy: { timestamp: 'asc' },
      }),
    ]);

    // Bucket the flat query results by lot.id
    const eventsByLot = new Map<string, typeof events>();
    for (const e of events) {
      const arr = eventsByLot.get(e.lot_id);
      if (arr) arr.push(e);
      else eventsByLot.set(e.lot_id, [e]);
    }

    const predictionsByLot = new Map<string, typeof predictions>();
    for (const p of predictions) {
      const arr = predictionsByLot.get(p.lot_id);
      if (arr) arr.push(p);
      else predictionsByLot.set(p.lot_id, [p]);
    }

    const snapshotsByLot = new Map<string, typeof snapshots>();
    for (const s of snapshots) {
      const arr = snapshotsByLot.get(s.lot_id);
      if (arr) arr.push(s);
      else snapshotsByLot.set(s.lot_id, [s]);
    }

    // groupBy emitted one row per (lot_id, user_id) pair - collapse to a count per lot
    const reporterCountByLot = new Map<string, number>();
    for (const row of reporterRows) {
      reporterCountByLot.set(row.lot_id, (reporterCountByLot.get(row.lot_id) ?? 0) + 1);
    }

    // Assemble each lot's input from its bucket slice (shared with single-lot path)
    for (const lot of lots) {
      result.set(
        lot.lot_id,
        this.assembleReliabilityInput(
          lot,
          eventsByLot.get(lot.id) ?? [],
          predictionsByLot.get(lot.id) ?? [],
          snapshotsByLot.get(lot.id) ?? [],
          reporterCountByLot.get(lot.id) ?? 0,
          now,
        ),
      );
    }

    return result;
  }

  /**
   * Pure assembly of a ReliabilityInput from already-fetched per-lot data.
   * Both gatherReliabilityInput (single-lot) and gatherReliabilityInputsBatch
   * (all lots) feed this so the freshness/sample/accuracy logic lives in one
   * place — drift between the two paths becomes impossible.
   */
  private assembleReliabilityInput(
    lot: { penetration_rate: number },
    events: Array<{ timestamp: Date; device_hash: string }>,
    predictions: Array<{ target_time: Date; predicted_occupancy: number }>,
    snapshots: Array<{ timestamp: Date; occupancy_rate: number }>,
    uniqueReportersInWindow: number,
    now: Date,
  ): ReliabilityInput {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentEvents = events.filter((e) => e.timestamp >= oneHourAgo);
    const olderEvents = events.filter((e) => e.timestamp < oneHourAgo);

    // Freshness: prefer last-hour event timestamp; fall back to last 1–2h; cap at 120.
    let minutesSinceLastEvent = 60;
    if (recentEvents.length > 0) {
      const last = recentEvents[recentEvents.length - 1].timestamp;
      minutesSinceLastEvent = (now.getTime() - last.getTime()) / 60000;
    } else if (olderEvents.length > 0) {
      const last = olderEvents[olderEvents.length - 1].timestamp;
      minutesSinceLastEvent = (now.getTime() - last.getTime()) / 60000;
    } else {
      minutesSinceLastEvent = 120;
    }

    const uniqueDevices = new Set(recentEvents.map((e) => e.device_hash));
    
    // Cap at 100 — keeps MAPE input consistent across paths regardless of how
    // predictions were originally fetched.
    const cappedPredictions = predictions.slice(0, 100);
    const historicalAccuracy = this.computeAccuracyFromSamples(
      cappedPredictions,
      snapshots,
    );

    return {
      penetrationRate: lot.penetration_rate || 0,
      minutesSinceLastEvent: Math.min(120, minutesSinceLastEvent),
      eventsInLastHour: recentEvents.length,
      uniqueDevicesInLastHour: uniqueDevices.size,
      historicalAccuracy,
      uniqueReportersInWindow,
    };
  }

  /**
   * Gathers input data for a single lot. Public so OccupancyEventsService can
   * use the same logic for snapshot generation.
   *
   * Fetches the same four data sources as the batch path (events, reports,
   * predictions, snapshots) in parallel, then hands them to the shared
   * assembler so the resulting ReliabilityInput is identical to what
   * gatherReliabilityInputsBatch would produce for this lot.
   */
  async gatherReliabilityInput(
    lot: { id: string; penetration_rate: number },
    thresholds: ReliabilityThresholds = this.reliabilityService.getDefaultThresholds(),
  ): Promise<ReliabilityInput> {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const reportsWindowStart = new Date(
      now.getTime() - thresholds.userReportsWindowMinutes * 60 * 1000,
    );

    const [events, distinctReporters, predictions, snapshots] = await Promise.all([
      this.prisma.occupancyEvent.findMany({
        where: { lot_id: lot.id, timestamp: { gte: twoHoursAgo, lte: now } },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.report.findMany({
        where: { lot_id: lot.id, created_at: { gte: reportsWindowStart, lte: now } },
        distinct: ['user_id'],
        select: { user_id: true },
      }),
      this.prisma.predictionShortTerm.findMany({
        where: { lot_id: lot.id, target_time: { gte: sevenDaysAgo, lte: now } },
        orderBy: { target_time: 'asc' },
      }),
      this.prisma.occupancySnapshot.findMany({
        where: {
          lot_id: lot.id,
          timestamp: {
            gte: new Date(sevenDaysAgo.getTime() - 10 * 60 * 1000),
            lte: new Date(now.getTime() + 10 * 60 * 1000),
          },
        },
        orderBy: { timestamp: 'desc' },
      }),
    ]);

    return this.assembleReliabilityInput(
      lot,
      events,
      predictions,
      snapshots,
      distinctReporters.length,
      now,
    );
  }

  /**
   * Computes historical accuracy by comparing past short-term predictions
   * against actual snapshot data for a lot.
   *
   * Returns a value between 0 and 1 where 1 = perfect accuracy, or null if
   * insufficient data (< 10 comparisons) to be meaningful.
   *
   * Uses Mean Absolute Percentage Error (MAPE) inverted to an accuracy score:
   * accuracy = max(0, 1 - MAPE)
   */
  private computeAccuracyFromSamples(
    predictions: Array<{ target_time: Date; predicted_occupancy: number }>,
    snapshots: Array<{ timestamp: Date; occupancy_rate: number }>,
  ): number | null {
    if (predictions.length < 10) return null;

    let totalError = 0;
    let comparisons = 0;
    const windowMs = 10 * 60 * 1000;

    for (const pred of predictions) {
      const targetTimeMs = pred.target_time.getTime();
      
      let closestSnapshot: { timestamp: Date; occupancy_rate: number } | null = null;
      let minDiffMs = windowMs;

      for (const snap of snapshots) {
        const diffMs = Math.abs(snap.timestamp.getTime() - targetTimeMs);
        if (diffMs <= minDiffMs) {
          minDiffMs = diffMs;
          closestSnapshot = snap;
        }
      }

      if (closestSnapshot && closestSnapshot.occupancy_rate > 0) {
        const error = Math.abs(pred.predicted_occupancy - closestSnapshot.occupancy_rate) / closestSnapshot.occupancy_rate;
        totalError += error;
        comparisons++;
      }
    }

    if (comparisons < 10) return null;

    const mape = totalError / comparisons;
    return Math.max(0, Math.round((1 - mape) * 1000) / 1000);
  }
}
