import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { CampusEvent, EventImpact, CampusEventType } from '@prisma/client';

const VALID_EVENT_TYPES: string[] = ['ATHLETIC', 'ACADEMIC', 'PERFORMANCE', 'OTHER'];

/**
 * Service for campus events that may affect parking availability.
 * Events include sports games, graduation, orientations, etc.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Retrieves all campus events, optionally filtered by event type. */
  async findAll(eventType?: string): Promise<CampusEvent[]> {
    try {
      let where: { event_type?: CampusEventType } | undefined;
      if (eventType) {
        if (!VALID_EVENT_TYPES.includes(eventType)) {
          throw new BadRequestException(
            `Invalid event type '${eventType}'. Valid types: ${VALID_EVENT_TYPES.join(', ')}`,
          );
        }
        where = { event_type: eventType as CampusEventType };
      }
      return await this.prisma.campusEvent.findMany({
        where,
        orderBy: { start_time: 'asc' },
      });
    } catch (error) {
      this.logger.error('Failed to fetch campus events', error);
      throw error;
    }
  }

  /** Retrieves parking lot impacts for a specific event (closures, capacity changes). */
  async getImpacts(eventId: string): Promise<EventImpact[]> {
    try {
      return await this.prisma.eventImpact.findMany({
        where: { event_id: eventId },
      });
    } catch (error) {
      this.logger.error(`Failed to fetch impacts for event ${eventId}`, error);
      throw error;
    }
  }

  /**
   * Retrieves upcoming events that impact a specific lot within the given time window.
   * Returns events with their impact data, sorted by start time.
   */
  async getUpcomingImpactsForLot(
    lotInternalId: string,
    windowHours: number = 24,
  ): Promise<Array<{ event: CampusEvent; impact: EventImpact }>> {
    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

      const impacts = await this.prisma.eventImpact.findMany({
        where: {
          lot_id: lotInternalId,
          event: {
            start_time: { lte: windowEnd },
            end_time: { gte: now },
          },
        },
        include: { event: true },
        orderBy: { event: { start_time: 'asc' } },
      });

      return impacts.map((i) => ({ event: i.event, impact: i }));
    } catch (error) {
      this.logger.error(`Failed to fetch upcoming impacts for lot ${lotInternalId}`, error);
      return [];
    }
  }

  /**
   * Batch-fetches active event impacts for multiple lots.
   * Returns a Map from lot internal ID to aggregate expected_increase_percent.
   */
  async getActiveImpactsForLots(
    lotInternalIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (lotInternalIds.length === 0) return result;

    try {
      const now = new Date();

      const impacts = await this.prisma.eventImpact.findMany({
        where: {
          lot_id: { in: lotInternalIds },
          event: {
            start_time: { lte: now },
            end_time: { gte: now },
          },
        },
        include: { event: true },
      });

      // Aggregate: take max expected_increase_percent per lot
      for (const impact of impacts) {
        const current = result.get(impact.lot_id) ?? 0;
        result.set(impact.lot_id, Math.max(current, impact.expected_increase_percent));
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to batch-fetch active event impacts', error);
      return result;
    }
  }
}
