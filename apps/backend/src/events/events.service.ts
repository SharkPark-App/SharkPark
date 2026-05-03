import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { CampusEvent, CampusEventType } from '@prisma/client';

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

  /** Retrieves upcoming events within a time window using a DB query. */
  async findUpcoming(windowEnd: Date): Promise<CampusEvent[]> {
    try {
      const now = new Date();
      return await this.prisma.campusEvent.findMany({
        where: {
          start_time: { lte: windowEnd },
          end_time: { gte: now },
        },
        orderBy: { start_time: 'asc' },
      });
    } catch (error) {
      this.logger.error('Failed to fetch upcoming campus events', error);
      throw error;
    }
  }
}
