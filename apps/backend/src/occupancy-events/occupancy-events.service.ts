import { Injectable, Logger, InternalServerErrorException, NotFoundException, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { OccupancyEvent, EventType } from '@prisma/client';
import { CreateOccupancyEventDto } from './dto/create-occupancy-event.dto';
import type {
  OccupancySnapshot,
  CreateEventResponse,
  EventStats,
} from './interfaces/occupancy-event.interface';
import { hashDeviceId, generateEventId } from './utils/privacy.util';
import { ReliabilityService } from '../reliability/reliability.service';
import { ReliabilityComputationService } from '../reliability/reliability-computation.service';
import { PenetrationEstimationService } from '../lots/penetration-estimation.service';
import {
  getSemester,
  getWeekOfSemester,
} from '../lots/academic-calendar';

/** Service for anonymous occupancy events - handles storage, deduplication, and real-time updates */
@Injectable()
export class OccupancyEventsService {
  private readonly logger = new Logger(OccupancyEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ReliabilityService)) private readonly reliabilityService: ReliabilityService,
    @Inject(forwardRef(() => ReliabilityComputationService)) private readonly reliabilityComputationService: ReliabilityComputationService,
    private readonly penetrationService: PenetrationEstimationService,
  ) {}

  /**
   * Records an anonymous occupancy event and updates lot occupancy.
   * Trusts client-side validation - events that reach here have already been
   * validated using real sensor data (speed, location, behavioral patterns).
   * Includes deduplication logic to prevent ENTER→ENTER or EXIT→EXIT.
   */
  async create(dto: CreateOccupancyEventDto): Promise<CreateEventResponse> {
    // hash server-side
    const deviceHash = hashDeviceId(dto.device_id);
    const eventId = generateEventId();
    const now = new Date().toISOString();

    // Find the lot's internal ID (single lookup, reused for deduplication + transaction)
    const lot = await this.prisma.lot.findFirst({ where: { lot_id: dto.lot_id } });
    if (!lot) {
      throw new NotFoundException(`Lot ${dto.lot_id} not found`);
    }

    // Check for duplicate event (same device, same lot, same event type)
    const isDuplicate = await this.checkDuplicate(lot.id, deviceHash, dto.event_type);

    if (isDuplicate) {
      this.logger.warn(
        `Duplicate ${dto.event_type} event ignored for lot ${dto.lot_id} from device ${deviceHash.substring(0, 8)}...`
      );
      return {
        event_id: eventId,
        lot_id: dto.lot_id,
        event_type: dto.event_type,
        recorded_at: now,
        deduplicated: true,
      };
    }

    try {
      // Use a transaction for atomicity: store event + update occupancy + update device state
      await this.prisma.$transaction(async (tx) => {
        // Store the basic occupancy event
        await tx.occupancyEvent.create({
          data: {
            lot_id: lot.id,
            event_type: dto.event_type as EventType,
            device_hash: deviceHash,
            timestamp: new Date(dto.timestamp),
          },
        });

        // Update lot occupancy atomically
        const increment = dto.event_type === 'ENTER' ? 1 : -1;
        if (dto.event_type === 'EXIT' && lot.current_occupancy <= 0) {
          this.logger.warn(`Cannot decrement occupancy below 0 for lot ${dto.lot_id}`);
        } else {
          await tx.lot.update({
            where: { id: lot.id },
            data: { current_occupancy: { increment } },
          });
        }

        // Update device's last event type for deduplication
        await tx.deviceState.upsert({
          where: { device_hash_lot_id: { device_hash: deviceHash, lot_id: lot.id } },
          update: { last_event_type: dto.event_type as EventType, updated_at: new Date() },
          create: { device_hash: deviceHash, lot_id: lot.id, last_event_type: dto.event_type as EventType },
        });
      });

      this.logger.log(
        `Recorded ${dto.event_type} event for lot ${dto.lot_id} (device: ${deviceHash.substring(0, 8)}...)`
      );

      return {
        event_id: eventId,
        lot_id: dto.lot_id,
        event_type: dto.event_type,
        recorded_at: now,
        deduplicated: false,
      };
    } catch (error) {
      this.logger.error(`Failed to record occupancy event for lot ${dto.lot_id}`, error);
      throw new InternalServerErrorException('Failed to record occupancy event');
    }
  }

  /**
   * Retrieves events for a specific lot within a date range.
   */
  async findByLot(
    lotId: string,
    startDate: string,
    endDate: string,
    limit: number = 1000,
  ): Promise<OccupancyEvent[]> {
    try {
      const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
      if (!lot) return [];

      return await this.prisma.occupancyEvent.findMany({
        where: {
          lot_id: lot.id,
          timestamp: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
        orderBy: { timestamp: 'asc' },
        take: limit,
      });
    } catch (error) {
      this.logger.error(`Failed to fetch events for lot ${lotId}`, error);
      throw new InternalServerErrorException(`Failed to fetch events for lot ${lotId}`);
    }
  }

  /**
   * Gets event statistics for a lot over a time period.
   */
  async getEventStats(lotId: string, startDate: string, endDate: string): Promise<EventStats> {
    const events = await this.findByLot(lotId, startDate, endDate);

    const totalEnters = events.filter(e => e.event_type === 'ENTER').length;
    const totalExits = events.filter(e => e.event_type === 'EXIT').length;

    return {
      lot_id: lotId,
      start_date: startDate,
      end_date: endDate,
      total_enters: totalEnters,
      total_exits: totalExits,
      net_change: totalEnters - totalExits,
    };
  }

  /**
   * Creates occupancy snapshots for all lots.
   * Called by a scheduled job every 15 minutes for ML training data.
   */
  async createSnapshots(): Promise<{ count: number; timestamp: string }> {
    const now = new Date();
    const timestamp = now.toISOString();

    try {
      const lots = await this.prisma.lot.findMany();

      // Batch-estimate penetration for all lots at once
      const estimates = await this.penetrationService.estimateForAllLots(lots, now);

      // Compute academic calendar features once for the batch.
      // Convert to school local time so calendar lookups are date-correct.
      const schoolId = lots[0]?.school_id;
      const schoolTz = schoolId
        ? await this.penetrationService.getSchoolTimezone(schoolId)
        : 'America/Los_Angeles';
      const schoolTime = this.penetrationService.toSchoolTime(now, schoolTz);

      const semester = getSemester(schoolTime);
      const [weekOfSemester, periodType] = getWeekOfSemester(schoolTime);
      const academicPeriod = periodType;

      let count = 0;
      for (const lot of lots) {
        const estimate = estimates.get(lot.id);
        const rawOccupancy = lot.current_occupancy || 0;
        const estimatedOccupancy = estimate ? estimate.estimatedOccupancy : rawOccupancy;
        const capacity = lot.capacity || 100;

        // Snapshot stores raw occupancy/available/rate for ML consistency;
        // estimated_occupancy is the separate scaled-up field
        const rawAvailable = Math.max(0, capacity - rawOccupancy);
        const rawOccupancyRate = capacity > 0 ? rawOccupancy / capacity : 0;

        // Compute confidence using ReliabilityComputationService (single source of truth)
        const reliabilityInput = await this.reliabilityComputationService.gatherReliabilityInput(lot.lot_id, lot);
        const reliabilityScore = this.reliabilityService.computeReliabilitySummary(
          lot.lot_id,
          reliabilityInput,
        );
        const confidence = reliabilityScore.confidence;

        await this.prisma.occupancySnapshot.create({
          data: {
            lot_id: lot.id,
            timestamp: now,
            occupancy: rawOccupancy,
            available: rawAvailable,
            occupancy_rate: Math.round(rawOccupancyRate * 1000) / 1000,
            confidence,
            reliability_score: reliabilityScore.score,
            is_cold_start: reliabilityScore.isColdStart,
            semester,
            academic_period: academicPeriod,
            week_of_semester: weekOfSemester,
            is_campus_open: estimate ? !estimate.isClosure : true,
            estimated_occupancy: estimatedOccupancy,
            penetration_rate_used: estimate
              ? Math.round(estimate.effectiveRate * 10000) / 10000
              : null,
          },
        });

        count++;
      }

      this.logger.log(`Created ${count} occupancy snapshots at ${timestamp}`);
      return { count, timestamp };
    } catch (error) {
      this.logger.error('Failed to create occupancy snapshots', error);
      throw new InternalServerErrorException('Failed to create occupancy snapshots');
    }
  }

  /**
   * Retrieves snapshots for a lot on a specific date.
   */
  async getSnapshots(lotId: string, date: string, limit: number = 96): Promise<OccupancySnapshot[]> {
    try {
      const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
      if (!lot) return [];

      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      return await this.prisma.occupancySnapshot.findMany({
        where: {
          lot_id: lot.id,
          timestamp: { gte: startOfDay, lte: endOfDay },
        },
        orderBy: { timestamp: 'asc' },
        take: limit,
      });
    } catch (error) {
      this.logger.error(`Failed to fetch snapshots for lot ${lotId} on ${date}`, error);
      throw new InternalServerErrorException(`Failed to fetch snapshots for lot ${lotId}`);
    }
  }

  /**
   * Checks if this event is a duplicate (same event type as last event from this device).
   * Accepts the lot's internal (cuid) ID directly to avoid redundant DB lookups.
   */
  private async checkDuplicate(
    lotInternalId: string,
    deviceHash: string,
    eventType: 'ENTER' | 'EXIT',
  ): Promise<boolean> {
    try {
      const deviceState = await this.prisma.deviceState.findUnique({
        where: { device_hash_lot_id: { device_hash: deviceHash, lot_id: lotInternalId } },
      });

      if (!deviceState) {
        return false; // First event from this device for this lot
      }

      return deviceState.last_event_type === eventType;
    } catch (error) {
      this.logger.warn(`Failed to check duplicate for lot ${lotInternalId}, proceeding anyway`, error);
      return false;
    }
  }
}
