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

    try {
      // Perform dedup check + event recording inside a single transaction
      // to prevent concurrent requests from the same device slipping through.
      const result = await this.prisma.$transaction(async (tx) => {
        // Check for duplicate event inside the transaction
        const deviceState = await tx.deviceState.findUnique({
          where: { device_hash_lot_id: { device_hash: deviceHash, lot_id: lot.id } },
        });

        if (deviceState && deviceState.last_event_type === dto.event_type) {
          return { deduplicated: true } as const;
        }

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
        if (dto.event_type === 'EXIT') {
          // Atomic decrement with floor at 0 — eliminates read-then-write race condition
          await tx.$executeRaw`UPDATE lots SET current_occupancy = GREATEST(current_occupancy - 1, 0), updated_at = NOW() WHERE id = ${lot.id}`;
        } else {
          await tx.lot.update({
            where: { id: lot.id },
            data: { current_occupancy: { increment: 1 } },
          });
        }

        // Update device's last event type for deduplication
        await tx.deviceState.upsert({
          where: { device_hash_lot_id: { device_hash: deviceHash, lot_id: lot.id } },
          update: { last_event_type: dto.event_type as EventType, updated_at: new Date() },
          create: { device_hash: deviceHash, lot_id: lot.id, last_event_type: dto.event_type as EventType },
        });

        return { deduplicated: false } as const;
      });

      if (result.deduplicated) {
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
   * Cleans up stale DeviceState records where an ENTER was recorded but no
   * EXIT ever arrived (app killed, phone died, permissions revoked, etc.).
   *
   * For each stale record, decrements the lot's occupancy and deletes the
   * DeviceState row. The GREATEST(current_occupancy - 1, 0) floor prevents
   * negative occupancy.
   *
   * Called by the scheduler at 3 AM daily (Pacific).
   */
  async cleanupStaleDeviceStates(maxAgeHours: number = 18): Promise<{ cleaned: number }> {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

    try {
      // Find all ENTER device states older than the cutoff
      const staleStates = await this.prisma.deviceState.findMany({
        where: {
          last_event_type: 'ENTER',
          updated_at: { lt: cutoff },
        },
        select: { id: true, lot_id: true, device_hash: true },
      });

      if (staleStates.length === 0) {
        return { cleaned: 0 };
      }

      // Batch: aggregate decrements per lot, then delete all stale records in one transaction
      const decrementsByLot = new Map<string, number>();
      const staleIds = staleStates.map((s) => {
        decrementsByLot.set(s.lot_id, (decrementsByLot.get(s.lot_id) ?? 0) + 1);
        return s.id;
      });

      await this.prisma.$transaction(async (tx) => {
        for (const [lotId, count] of decrementsByLot) {
          await tx.$executeRaw`UPDATE lots SET current_occupancy = GREATEST(current_occupancy - ${count}, 0), updated_at = NOW() WHERE id = ${lotId}`;
        }
        await tx.deviceState.deleteMany({ where: { id: { in: staleIds } } });
      });

      this.logger.log(`Cleaned up ${staleStates.length} stale ENTER device states (older than ${maxAgeHours}h)`);
      return { cleaned: staleStates.length };
    } catch (error) {
      this.logger.error('Failed to clean up stale device states', error);
      throw new InternalServerErrorException('Failed to clean up stale device states');
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
    const cappedLimit = Math.min(limit, 1000);
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
        take: cappedLimit,
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
    try {
      const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
      if (!lot) {
        return {
          lot_id: lotId,
          start_date: startDate,
          end_date: endDate,
          total_enters: 0,
          total_exits: 0,
          net_change: 0,
        };
      }

      const counts = await this.prisma.occupancyEvent.groupBy({
        by: ['event_type'],
        where: {
          lot_id: lot.id,
          timestamp: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
        _count: { event_type: true },
      });

      const totalEnters = counts.find(c => c.event_type === 'ENTER')?._count.event_type ?? 0;
      const totalExits = counts.find(c => c.event_type === 'EXIT')?._count.event_type ?? 0;

      return {
        lot_id: lotId,
        start_date: startDate,
        end_date: endDate,
        total_enters: totalEnters,
        total_exits: totalExits,
        net_change: totalEnters - totalExits,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch event stats for lot ${lotId}`, error);
      throw new InternalServerErrorException(`Failed to fetch event stats for lot ${lotId}`);
    }
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

      // Attach the latest weather record so each snapshot captures conditions at write time
      const latestWeather = schoolId
        ? await this.prisma.weather.findFirst({
            where: { school_id: schoolId },
            orderBy: { timestamp: 'desc' },
          })
        : null;

      let count = 0;

      // Gather reliability input for all lots in parallel (avoids N+1 DB calls)
      const reliabilityInputs = await Promise.all(
        lots.map((lot) => this.reliabilityComputationService.gatherReliabilityInput(lot.lot_id, lot)),
      );

      // Build snapshot data array
      const snapshotData = lots.map((lot, i) => {
        const estimate = estimates.get(lot.id);
        const rawOccupancy = lot.current_occupancy || 0;
        const estimatedOccupancy = estimate ? estimate.estimatedOccupancy : rawOccupancy;
        const capacity = lot.capacity || 100;

        const rawAvailable = Math.max(0, capacity - rawOccupancy);
        const rawOccupancyRate = capacity > 0 ? rawOccupancy / capacity : 0;

        const reliabilityScore = this.reliabilityService.computeReliabilitySummary(
          lot.lot_id,
          reliabilityInputs[i],
        );

        return {
          lot_id: lot.id,
          timestamp: now,
          occupancy: rawOccupancy,
          available: rawAvailable,
          occupancy_rate: Math.round(rawOccupancyRate * 1000) / 1000,
          confidence: reliabilityScore.confidence,
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
          weather_id: latestWeather?.id ?? null,
        };
      });

      // Batch insert all snapshots in a single query
      const result = await this.prisma.occupancySnapshot.createMany({ data: snapshotData });
      count = result.count;

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
}
