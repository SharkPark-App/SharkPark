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
  /** Scaled-up occupancy estimate based on penetration rate */
  estimated_occupancy: number;
  /** Spots available based on estimated occupancy */
  estimated_available: number;
  /** The raw device count before scaling (same as current_occupancy) */
  raw_occupancy: number;
  /** Effective penetration rate used for this estimate (0.01–1.0) */
  effective_penetration_rate: number;
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

export interface LotRecommendation extends ParkingLotResponse {
  /** Overall recommendation score 0–100 */
  recommendation_score: number;
  /** Haversine distance in meters from the source lot */
  distance_meters: number;
  /** Why this lot was recommended */
  reason: string;
}
