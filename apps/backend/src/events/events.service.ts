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
}
