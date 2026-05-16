import type { Lot as PrismaLot, AdvisorySeverity, AdvisorySource, BuildingCategory } from '@prisma/client';
import type { AppliedFees } from '../permit-fees';

/**
 * Re-export Prisma's Lot type for convenience.
 * Services can use the Prisma-generated type directly.
 */
export type ParkingLot = PrismaLot;

/**
 * Active operational notice for a lot — construction zone, full closure,
 * partial detour. Sourced from the campus map (concept3d) and refreshed
 * weekly by the `refresh-lot-advisories` cron. Always present in the
 * response (static metadata, not contributor-gated).
 */
export interface LotAdvisoryResponse {
  id: string;
  title: string;
  description: string | null;
  severity: AdvisorySeverity;
  source: AdvisorySource;
  match_reason: string;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
}

/** Building reference attached to a lot. Includes category so the mobile UI
 *  can group nearby buildings (Academic, Housing, Athletic, etc.). */
export interface LotBuildingResponse {
  name: string;
  category: BuildingCategory;
}

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
  /** Buildings this lot serves (derived from LotBuilding join), with category for grouped display. */
  buildings: LotBuildingResponse[];
  /** Active operational notices (closures, construction). Empty when none. */
  advisories: LotAdvisoryResponse[];
  /**
   * Visitor-facing fee block derived from the static CSULB schedule
   * (`CSULB_PERMIT_FEES`) and lot-specific eligibility flags. Always present
   * — never contributor-gated — so the mobile Visitor Pricing card can
   * render without a second round-trip. Fields inside may be null when the
   * lot is not eligible for that fee type (e.g. no short-term spaces).
   */
  applied_fees: AppliedFees;
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

export interface TrendPoint {
  /** ISO 8601 datetime truncated to the hour */
  hour: string;
  /**
   * Average raw `occupancy_rate` (device count / capacity) over the bucket.
   * This is a device-coverage signal, NOT true lot fullness — it understates
   * occupancy whenever penetration < 100%. Prefer `avg_estimated_rate` when
   * measuring actual utilization.
   */
  avg_occupancy_rate: number;
  avg_occupancy: number;
  avg_available: number;
  /**
   * Average penetration-corrected fullness (`estimated_occupancy / capacity`)
   * over the bucket — a better proxy for actual lot occupancy than the raw
   * device rate, since each snapshot's `estimated_occupancy` was scaled by
   * the live penetration rate at write time. `null` when no snapshot in the
   * bucket carried an estimate (rows written before the penetration rollout).
   */
  avg_estimated_rate: number | null;
  /** Average `estimated_occupancy` (vehicles, not devices) over the bucket. */
  avg_estimated_occupancy: number | null;
  sample_count: number;
}

export interface LotUtilization {
  lot_id: string;
  display_name: string;
  lot_type: string;
  capacity: number;
  /**
   * Average raw `occupancy_rate` over the range; `null` when no snapshots
   * exist. Device-coverage signal — see `avg_estimated_utilization` for true
   * fullness.
   */
  avg_utilization: number | null;
  /**
   * Average penetration-corrected utilization
   * (`estimated_occupancy / capacity`) over the range. Prefer this over
   * `avg_utilization` when ranking lots by actual fullness. `null` when no
   * snapshot in the range carried an estimate.
   */
  avg_estimated_utilization: number | null;
  snapshot_count: number;
}
