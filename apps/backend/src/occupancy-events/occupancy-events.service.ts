import { Injectable, Logger, InternalServerErrorException, forwardRef, Inject } from '@nestjs/common';
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
import type { ReliabilityInput } from '../reliability/interfaces';

/** Service for anonymous occupancy events - handles storage, deduplication, and real-time updates */
@Injectable()
export class OccupancyEventsService {
  private readonly logger = new Logger(OccupancyEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ReliabilityService)) private readonly reliabilityService: ReliabilityService,
  ) {}

  /**
   * Records an anonymous occupancy event and updates lot occupancy.
   * Includes deduplication logic to prevent ENTER→ENTER or EXIT→EXIT.
   */
  async create(dto: CreateOccupancyEventDto): Promise<CreateEventResponse> {
    // Use client-provided hash if available, otherwise generate one
    const deviceHash = dto.device_hash || hashDeviceId(dto.device_id);
    const eventId = generateEventId();
    const now = new Date().toISOString();

    // Check for duplicate event (same device, same lot, same event type)
    const isDuplicate = await this.checkDuplicate(dto.lot_id, deviceHash, dto.event_type);

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

    // Find the lot's internal ID
    const lot = await this.prisma.lot.findFirst({ where: { lot_id: dto.lot_id } });
    if (!lot) {
      throw new InternalServerErrorException(`Lot ${dto.lot_id} not found`);
    }

    // Determine if this event should count toward occupancy based on client validation
    const shouldCountTowardOccupancy = this.shouldCountTowardOccupancy(dto);

    try {
      // Use a transaction for atomicity: store event + update occupancy + update device state
      await this.prisma.$transaction(async (tx) => {
        // Store the event with validation data
        await tx.occupancyEvent.create({
          data: {
            lot_id: lot.id,
            event_type: dto.event_type as EventType,
            device_hash: deviceHash,
            timestamp: new Date(dto.timestamp),
            validation_status: dto.validation_status || null,
            confidence_score: dto.confidence_score || null,
            analysis_metadata: dto.analysis_metadata ? JSON.parse(JSON.stringify(dto.analysis_metadata)) : undefined,
          },
        });

        // Update lot occupancy atomically - only if validation indicates it should count
        if (shouldCountTowardOccupancy) {
          const increment = dto.event_type === 'ENTER' ? 1 : -1;
          if (dto.event_type === 'EXIT' && lot.current_occupancy <= 0) {
            this.logger.warn(`Cannot decrement occupancy below 0 for lot ${dto.lot_id}`);
          } else {
            await tx.lot.update({
              where: { id: lot.id },
              data: { current_occupancy: { increment } },
            });
          }
        }

        // Update device's last event type for deduplication
        await tx.deviceState.upsert({
          where: { device_hash_lot_id: { device_hash: deviceHash, lot_id: lot.id } },
          update: { last_event_type: dto.event_type as EventType, updated_at: new Date() },
          create: { device_hash: deviceHash, lot_id: lot.id, last_event_type: dto.event_type as EventType },
        });
      });

      const logMessage = shouldCountTowardOccupancy 
        ? `Recorded ${dto.event_type} event for lot ${dto.lot_id} (validation: ${dto.validation_status || 'none'})`
        : `Recorded ${dto.event_type} event for lot ${dto.lot_id} (excluded from occupancy: ${dto.validation_status})`;
      
      this.logger.log(`${logMessage} (device: ${deviceHash.substring(0, 8)}...)`);

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
   * Determine if an event should count toward occupancy based on client-side validation
   */
  private shouldCountTowardOccupancy(dto: CreateOccupancyEventDto): boolean {
    // If no validation status provided, count all events (backward compatibility)
    if (!dto.validation_status) {
      return true;
    }

    // Only count events that the client classified as actual parking
    // This filters out drive-throughs and searching behavior
    switch (dto.validation_status) {
      case 'PARKED':
        return true;
      case 'DROVE_THROUGH':
      case 'SEARCHING':
        return false;
      case 'ANALYZING':
      case 'UNKNOWN':
        // For uncertain classifications, use confidence score if available
        if (dto.confidence_score !== undefined) {
          return dto.confidence_score > 0.7; // High confidence threshold
        }
        return true; // Default to counting if no confidence score
      default:
        return true;
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

      let count = 0;
      for (const lot of lots) {
        const occupancy = lot.current_occupancy || 0;
        const capacity = lot.capacity || 100;
        const available = Math.max(0, capacity - occupancy);
        const occupancyRate = capacity > 0 ? occupancy / capacity : 0;

        // Compute confidence using ReliabilityService
        const reliabilityInput = await this.gatherReliabilityInput(lot.lot_id, lot);
        const reliabilityScore = this.reliabilityService.computeReliabilitySummary(
          lot.lot_id,
          reliabilityInput,
        );
        const confidence = reliabilityScore.confidence;

        await this.prisma.occupancySnapshot.create({
          data: {
            lot_id: lot.id,
            timestamp: now,
            occupancy,
            available,
            occupancy_rate: Math.round(occupancyRate * 1000) / 1000,
            confidence,
            reliability_score: reliabilityScore.score,
            is_cold_start: reliabilityScore.isColdStart,
            is_campus_open: true, // TODO: derive from academic calendar
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
   */
  private async checkDuplicate(
    lotId: string,
    deviceHash: string,
    eventType: 'ENTER' | 'EXIT',
  ): Promise<boolean> {
    try {
      const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
      if (!lot) return false;

      const deviceState = await this.prisma.deviceState.findUnique({
        where: { device_hash_lot_id: { device_hash: deviceHash, lot_id: lot.id } },
      });

      if (!deviceState) {
        return false; // First event from this device for this lot
      }

      return deviceState.last_event_type === eventType;
    } catch (error) {
      this.logger.warn(`Failed to check duplicate for lot ${lotId}, proceeding anyway`, error);
      return false;
    }
  }

  /**
   * Gathers input data required for reliability computation.
   */
  private async gatherReliabilityInput(
    lotId: string,
    lot: { id: string; penetration_rate: number; [key: string]: unknown },
  ): Promise<ReliabilityInput> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Get events from the last hour
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
    }

    // Count unique devices
    const uniqueDevices = new Set(recentEvents.map((e) => e.device_hash));

    return {
      penetrationRate: lot.penetration_rate || 0,
      minutesSinceLastEvent: Math.min(120, minutesSinceLastEvent),
      eventsInLastHour: recentEvents.length,
      uniqueDevicesInLastHour: uniqueDevices.size,
      historicalAccuracy: null,
    };
  }
}
