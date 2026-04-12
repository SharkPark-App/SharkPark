import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { ReliabilityService } from './reliability.service';
import {
  ReliabilityScore,
  ReliabilityScoreSummary,
  ReliabilityInput,
} from './interfaces';

@Injectable()
export class ReliabilityComputationService {
  private readonly logger = new Logger(ReliabilityComputationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reliabilityService: ReliabilityService,
  ) {}

  async computeReliabilityForLot(lotId: string): Promise<ReliabilityScore> {
    const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
    if (!lot) {
      throw new NotFoundException(`Lot ${lotId} not found`);
    }

    const input = await this.gatherReliabilityInput(lotId, lot);
    return this.reliabilityService.computeReliability(lotId, input);
  }

  async computeReliabilityForAllLots(): Promise<ReliabilityScoreSummary[]> {
    const lots = await this.prisma.lot.findMany();
    const results: ReliabilityScoreSummary[] = [];

    for (const lot of lots) {
      try {
        const input = await this.gatherReliabilityInput(lot.lot_id, lot);
        const summary = this.reliabilityService.computeReliabilitySummary(
          lot.lot_id,
          input,
        );
        results.push(summary);
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
   * Gathers input data required for reliability computation.
   * Public so OccupancyEventsService can use the same logic for snapshot generation.
   */
  async gatherReliabilityInput(
    lotId: string,
    lot: { id: string; penetration_rate: number },
  ): Promise<ReliabilityInput> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Get events from the last hour using a single query
    const recentEvents = await this.prisma.occupancyEvent.findMany({
      where: {
        lot_id: lot.id,
        timestamp: { gte: oneHourAgo, lte: now },
      },
      orderBy: { timestamp: 'asc' },
    });

    // Calculate minutes since last event
    let minutesSinceLastEvent = 60;
    if (recentEvents.length > 0) {
      const lastEventTime = recentEvents[recentEvents.length - 1].timestamp;
      minutesSinceLastEvent = (now.getTime() - lastEventTime.getTime()) / 60000;
    } else {
      // Check for events in last 2 hours
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const olderEvents = await this.prisma.occupancyEvent.findMany({
        where: {
          lot_id: lot.id,
          timestamp: { gte: twoHoursAgo, lt: oneHourAgo },
        },
        orderBy: { timestamp: 'desc' },
        take: 1,
      });
      if (olderEvents.length > 0) {
        const lastEventTime = olderEvents[0].timestamp;
        minutesSinceLastEvent = (now.getTime() - lastEventTime.getTime()) / 60000;
      } else {
        minutesSinceLastEvent = 120;
      }
    }

    // Count unique devices
    const uniqueDevices = new Set(recentEvents.map((e) => e.device_hash));

    // Get historical accuracy if available
    const historicalAccuracy = await this.getHistoricalAccuracy(lotId);

    return {
      penetrationRate: lot.penetration_rate || 0,
      minutesSinceLastEvent: Math.min(120, minutesSinceLastEvent),
      eventsInLastHour: recentEvents.length,
      uniqueDevicesInLastHour: uniqueDevices.size,
      historicalAccuracy,
    };
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
  private async getHistoricalAccuracy(lotId: string): Promise<number | null> {
    const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId }, select: { id: true } });
    if (!lot) return null;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Fetch recent predictions with corresponding snapshots
    const predictions = await this.prisma.predictionShortTerm.findMany({
      where: {
        lot_id: lot.id,
        target_time: { gte: sevenDaysAgo },
      },
      orderBy: { target_time: 'asc' },
      take: 100,
    });

    if (predictions.length < 10) return null;

    // For each prediction, find the closest snapshot
    let totalError = 0;
    let comparisons = 0;

    for (const pred of predictions) {
      const windowStart = new Date(pred.target_time.getTime() - 10 * 60 * 1000);
      const windowEnd = new Date(pred.target_time.getTime() + 10 * 60 * 1000);

      const snapshot = await this.prisma.occupancySnapshot.findFirst({
        where: {
          lot_id: lot.id,
          timestamp: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { timestamp: 'asc' },
      });

      if (snapshot && snapshot.occupancy > 0) {
        const error = Math.abs(pred.predicted_occupancy - snapshot.occupancy) / snapshot.occupancy;
        totalError += error;
        comparisons++;
      }
    }

    if (comparisons < 10) return null;

    const mape = totalError / comparisons;
    return Math.max(0, Math.round((1 - mape) * 1000) / 1000);
  }
}
