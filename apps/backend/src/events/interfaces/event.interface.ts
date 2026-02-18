import type {
  CampusEvent as PrismaCampusEvent,
  EventImpact as PrismaEventImpact,
} from '@prisma/client';

/**
 * Re-export Prisma types for convenience.
 */
export type CampusEvent = PrismaCampusEvent;
export type EventImpact = PrismaEventImpact;
