import type { Lot as PrismaLot } from '@prisma/client';

/**
 * Re-export Prisma's Lot type for convenience.
 * Services can use the Prisma-generated type directly.
 */
export type ParkingLot = PrismaLot;

export interface ParkingLotResponse extends PrismaLot {
  available: number;
  occupancy_rate: number;
  fill_status: 'AVAILABLE' | 'FILLING' | 'NEARLY_FULL' | 'FULL';
}

export interface GetLotsQueryParams {
  type?: 'STUDENT' | 'EMPLOYEE';
  available_only?: boolean;
  min_available?: number;
  permit_type?: string;
  daily_permit?: boolean;
  ev_charging?: boolean;
}

export interface OccupancySnapshotResponse {
  lot_id: string;
  timestamp: string;
  occupancy: number;
  available: number;
  occupancy_rate: number;
  confidence: string;
}
