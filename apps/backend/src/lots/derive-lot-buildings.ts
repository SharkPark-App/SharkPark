/**
 * Derives lot ↔ building proximity associations geometrically.
 *
 * Replaces hand-curated `LotSeed.buildings: BuildingName[]` lists. Now that
 * every building has authoritative concept3d coordinates, we compute "nearby"
 * at seed time using haversine distance from the lot centerpoint.
 *
 * Used by both seed.ts (dev) and seed-prod.ts (prod upsert) to populate
 * the `LotBuilding` join table. Generic over `TName` so callers can keep
 * their narrow `BuildingName` literal-union typing without forcing this
 * helper to import from the prisma seed scripts (which would cross
 * tsconfig rootDir boundaries).
 */

/** WGS84 mean Earth radius in meters. */
const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle distance between two lat/lng points in meters.
 * Standard haversine — accurate to ~0.5% across the globe; well below
 * what we need at campus scale.
 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Optional per-lot tweaks to the auto-derived list.
 *
 *   - `add`:     force-include building names regardless of distance
 *                (e.g. canonical destination just outside the radius)
 *   - `exclude`: force-exclude names that fall inside the radius but
 *                aren't a meaningful walking destination from this lot
 *                (e.g. blocked by railroad tracks, freeway, fenced area)
 */
export interface BuildingOverrides<TName extends string = string> {
  add?: TName[];
  exclude?: TName[];
}

/** Minimal shape required from a building seed entry. */
export interface BuildingPoint<TName extends string = string> {
  name: TName;
  lat: number;
  lng: number;
}

/** Minimal shape required from a lot seed entry. */
export interface LotPoint<TName extends string = string> {
  center_lat: number;
  center_lng: number;
  building_overrides?: BuildingOverrides<TName>;
}

/**
 * Default proximity radius (meters) — covers a brisk ~3 minute walk
 * from the lot centerpoint. Tuned against the existing manual lists.
 */
export const DEFAULT_LOT_BUILDING_RADIUS_M = 250;

/**
 * Returns the building names within `radiusMeters` of the lot's centerpoint,
 * applying any overrides. Output is deterministic (sorted) for stable diffs.
 */
export function deriveLotBuildings<TName extends string>(
  lot: LotPoint<TName>,
  buildings: readonly BuildingPoint<TName>[],
  radiusMeters: number = DEFAULT_LOT_BUILDING_RADIUS_M,
): TName[] {
  const lotPoint = { lat: lot.center_lat, lng: lot.center_lng };
  const within = new Set<TName>();

  for (const b of buildings) {
    const d = haversineMeters(lotPoint, { lat: b.lat, lng: b.lng });
    if (d <= radiusMeters) within.add(b.name);
  }

  const overrides = lot.building_overrides;
  if (overrides?.add) {
    for (const n of overrides.add) within.add(n);
  }
  if (overrides?.exclude) {
    for (const n of overrides.exclude) within.delete(n);
  }

  return [...within].sort();
}
