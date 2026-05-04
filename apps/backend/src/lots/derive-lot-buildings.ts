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
 * Project lat/lng to local east/north meters around a reference point using
 * an equirectangular approximation. Accurate to <<1% over a few hundred
 * meters at CSULB's latitude — plenty for proximity geometry.
 */
function toLocalXY(
  ref: { lat: number; lng: number },
  p: { lat: number; lng: number },
): { x: number; y: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cosRefLat = Math.cos(toRad(ref.lat));
  const x = toRad(p.lng - ref.lng) * cosRefLat * EARTH_RADIUS_M;
  const y = toRad(p.lat - ref.lat) * EARTH_RADIUS_M;
  return { x, y };
}

/** 2-D point-to-segment distance in meters (after toLocalXY projection). */
function pointToSegmentMeters(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Ray-casting point-in-polygon (even-odd rule) in projected XY. */
function pointInPolygonXY(
  p: { x: number; y: number },
  poly: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    const intersect =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Distance (meters) from a lat/lng point to the nearest edge of a polygon.
 * Returns 0 if the point is inside the polygon. Falls back to centroid
 * haversine when the polygon has fewer than 3 vertices (defensive — the
 * extractor guarantees ≥3 but seed data could be edited by hand).
 */
export function pointToPolygonMeters(
  point: { lat: number; lng: number },
  polygon: ReadonlyArray<{ lat: number; lng: number }>,
): number {
  if (polygon.length < 3) {
    // Degenerate polygon — fall back to centroid-style distance against the
    // first vertex if any, otherwise infinity (caller will skip).
    if (polygon.length === 0) return Number.POSITIVE_INFINITY;
    return haversineMeters(point, polygon[0]!);
  }
  const projected = polygon.map((v) => toLocalXY(point, v));
  const origin = { x: 0, y: 0 }; // point itself is the projection origin
  if (pointInPolygonXY(origin, projected)) return 0;

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0, j = projected.length - 1; i < projected.length; j = i++) {
    const d = pointToSegmentMeters(origin, projected[j]!, projected[i]!);
    if (d < min) min = d;
  }
  return min;
}

/** Do segments p1p2 and p3p4 properly intersect? (Excludes collinear cases —
 *  not relevant for distinct lot polygons.) */
function segmentsIntersectXY(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const cross = (
    o: { x: number; y: number },
    p: { x: number; y: number },
    q: { x: number; y: number },
  ) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/** Minimum distance between two segments in projected XY meters. */
function segmentToSegmentMeters(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): number {
  if (segmentsIntersectXY(p1, p2, p3, p4)) return 0;
  return Math.min(
    pointToSegmentMeters(p1, p3, p4),
    pointToSegmentMeters(p2, p3, p4),
    pointToSegmentMeters(p3, p1, p2),
    pointToSegmentMeters(p4, p1, p2),
  );
}

/**
 * Minimum distance (meters) between two polygons. Returns 0 when they
 * overlap (any vertex of one lies inside the other, or any pair of edges
 * crosses).
 *
 * For lots and buildings this is the honest "shortest walk" metric —
 * dramatically more accurate than centroid haversine for large or
 * irregularly shaped lots, where centerpoints can sit hundreds of meters
 * from the nearest practical entrance.
 *
 * Degenerate inputs (fewer than 3 vertices) fall back via the optional
 * centroid fallbacks: degenerate polygon collapses to its centroid and
 * is treated as a point against the other shape, or both centroids if
 * both polygons are degenerate. Returns +Infinity only when no fallback
 * is available — callers should treat that as "skip this pair".
 */
export function polygonToPolygonMeters(
  a: ReadonlyArray<{ lat: number; lng: number }>,
  b: ReadonlyArray<{ lat: number; lng: number }>,
  fallbackCentroidA?: { lat: number; lng: number },
  fallbackCentroidB?: { lat: number; lng: number },
): number {
  const validA = a.length >= 3;
  const validB = b.length >= 3;

  if (!validA && !validB) {
    if (fallbackCentroidA && fallbackCentroidB) {
      return haversineMeters(fallbackCentroidA, fallbackCentroidB);
    }
    return Number.POSITIVE_INFINITY;
  }
  if (!validA) {
    if (!fallbackCentroidA) return Number.POSITIVE_INFINITY;
    return pointToPolygonMeters(fallbackCentroidA, b);
  }
  if (!validB) {
    if (!fallbackCentroidB) return Number.POSITIVE_INFINITY;
    return pointToPolygonMeters(fallbackCentroidB, a);
  }

  // Project both polygons into a single local frame (centered on a[0]) so
  // all distance math is plain 2-D Euclidean meters.
  const ref = a[0]!;
  const aXY = a.map((v) => toLocalXY(ref, v));
  const bXY = b.map((v) => toLocalXY(ref, v));

  // Containment: if any vertex of one polygon lies inside the other, the
  // polygons overlap — distance is 0.
  for (const v of bXY) {
    if (pointInPolygonXY(v, aXY)) return 0;
  }
  for (const v of aXY) {
    if (pointInPolygonXY(v, bXY)) return 0;
  }

  // Otherwise, min distance over all edge-pair combinations. O(n*m) but at
  // campus scale (≤~100 verts per lot, ~40 lots) this is well under a
  // millisecond per call.
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0, ni = aXY.length; i < ni; i++) {
    const a1 = aXY[i]!;
    const a2 = aXY[(i + 1) % ni]!;
    for (let j = 0, nj = bXY.length; j < nj; j++) {
      const b1 = bXY[j]!;
      const b2 = bXY[(j + 1) % nj]!;
      const d = segmentToSegmentMeters(a1, a2, b1, b2);
      if (d < min) {
        min = d;
        if (min === 0) return 0;
      }
    }
  }
  return min;
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
  /**
   * Optional building footprint polygon (lat/lng vertices, no closing
   * duplicate). When present, proximity is computed point-to-edge instead
   * of point-to-centroid — captures buildings that extend within the
   * radius even though their centroid sits just outside.
   */
  polygon?: ReadonlyArray<{ lat: number; lng: number }> | null;
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
 * applying any overrides. Uses point-to-edge polygon distance when a
 * footprint is available, falling back to point-to-centroid haversine
 * when the polygon is null/missing. Output is deterministic (sorted) for
 * stable diffs.
 */
export function deriveLotBuildings<TName extends string>(
  lot: LotPoint<TName>,
  buildings: readonly BuildingPoint<TName>[],
  radiusMeters: number = DEFAULT_LOT_BUILDING_RADIUS_M,
): TName[] {
  const lotPoint = { lat: lot.center_lat, lng: lot.center_lng };
  const within = new Set<TName>();

  for (const b of buildings) {
    const d =
      b.polygon && b.polygon.length >= 3
        ? pointToPolygonMeters(lotPoint, b.polygon)
        : haversineMeters(lotPoint, { lat: b.lat, lng: b.lng });
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
