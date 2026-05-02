import type { Lot as PrismaLot } from '@prisma/client';

/**
 * Re-export Prisma's Lot type for convenience.
 * Services can use the Prisma-generated type directly.
 */
export type ParkingLot = PrismaLot;

export interface ParkingLotResponse extends Omit<PrismaLot, 'daily_rate' | 'current_occupancy'> {
  /**
   * Prisma stores this as `Decimal` but it is coerced to `number` at the
   * response boundary so JSON clients can do arithmetic / `.toFixed(...)`
   * directly without parsing strings.
   */
  daily_rate: number | null;

  /**
   * Live-occupancy fields below are REDACTED (returned as `null`) for
   * non-contributor callers on Public endpoints (`GET /lots`, `GET /lots/:id`).
   * This is the reciprocity model: a device that does not contribute its own
   * presence does not see live counts. Static metadata (capacity, permits,
   * coordinates, amenities, etc.) is always present so the App Store reviewer
   * — and any user who hasn't granted background location — can still see
   * which lots exist on campus.
   *
   * Mobile clients MUST treat each of these as nullable and render a
   * "locked" placeholder + soft-ask CTA when null. See LocationPermissionScreen.
   */
  current_occupancy: number | null;
  available: number | null;
  occupancy_rate: number | null;
  fill_status: 'AVAILABLE' | 'FILLING' | 'NEARLY_FULL' | 'FULL' | null;
  /** Scaled-up occupancy estimate based on penetration rate */
  estimated_occupancy: number | null;
  /** Spots available based on estimated occupancy */
  estimated_available: number | null;
  /** The raw device count before scaling (same as current_occupancy) */
  raw_occupancy: number | null;
  /** Effective penetration rate used for this estimate (0.01–1.0) */
  effective_penetration_rate: number | null;
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
