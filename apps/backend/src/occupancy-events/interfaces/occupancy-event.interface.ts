import type {
  OccupancyEvent as PrismaOccupancyEvent,
  OccupancySnapshot as PrismaOccupancySnapshot,
} from '@prisma/client';

/**
 * Re-export Prisma types for convenience.
 */
export type OccupancyEvent = PrismaOccupancyEvent;
export type OccupancySnapshot = PrismaOccupancySnapshot;

/**
 * Response from creating an occupancy event.
 */
export interface CreateEventResponse {
  event_id: string;
  lot_id: string;
  event_type: 'ENTER' | 'EXIT';
  recorded_at: string;
  deduplicated: boolean;
}

/**
 * Statistics for a lot's events over a time period.
 */
export interface EventStats {
  lot_id: string;
  start_date: string;
  end_date: string;
  total_enters: number;
  total_exits: number;
  net_change: number;
}

