/**
 * Pure extraction of lot-affecting advisories (construction zones, road
 * closures, partial closures) from concept3d API entries.
 *
 * No IO, no Prisma — accepts a list of concept3d locations + a list of lot
 * polygons and returns AdvisorySeed[] suitable for either the dev-time
 * generator (prisma/scripts/extract-lot-advisories.ts) or the weekly
 * refresh cron (src/scheduler/jobs/refresh-lot-advisories.job.ts).
 *
 * Sources (concept3d catIds → severity):
 *   - 45989  Road Closures                                  → CLOSURE
 *   - 91209  La Playa construction (incl. "Coming in 2026") → INFO/ADVISORY
 *   - 91668  Future U construction & detours                → ADVISORY
 *   - 101030 Misc construction (FCS new build, E10 exit)    → ADVISORY
 *
 * For every polygon-shaped advisory we attach it to a lot when EITHER:
 *   (a) the advisory name explicitly references the lot ("Lot E10",
 *       "Pyramid Parking Structure", "Palo Verde North/South")  →
 *       match_reason = "name_mention", OR
 *   (b) the advisory polygon overlaps the lot polygon          →
 *       match_reason = "polygon_overlap".
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type AdvisorySeverity = 'INFO' | 'ADVISORY' | 'CLOSURE';

export interface C3DShape {
  type: string;
  paths?: [number, number][];
  bounds?: [[number, number], [number, number]];
}

export interface C3DLocation {
  id: number;
  catId: number;
  name: string;
  lat: number;
  lng: number;
  shape?: C3DShape | null;
}

export interface AdvisorySeed {
  lot_id: string;
  title: string;
  description: string | null;
  severity: AdvisorySeverity;
  source: 'CONCEPT3D';
  source_cat_id: number;
  source_marker_id: number;
  match_reason: 'name_mention' | 'polygon_overlap';
  polygon: LatLng[];
}

export interface LotPolygon {
  /** Human lot code, e.g. "E10", "PYR". */
  lot_id: string;
  polygon: LatLng[];
}

export const ADVISORY_CATS: Record<number, { label: string; severity: AdvisorySeverity }> = {
  45989: { label: 'Road Closure', severity: 'CLOSURE' },
  91209: { label: 'La Playa Construction', severity: 'ADVISORY' },
  91668: { label: 'Future U Construction', severity: 'ADVISORY' },
  101030: { label: 'Construction', severity: 'ADVISORY' },
};

/**
 * Refine the cat-default severity using the marker name. Concept3d puts
 * suggested-detour exits ("Merriam Way Exit", "Beach Drive Exit") under
 * the same Road-Closure cat as the actual closure — those are alternate
 * routes you SHOULD take, not lot closures, so demote to ADVISORY. Names
 * carrying "Coming in YYYY" are forward-looking → INFO.
 */
export function refineSeverity(name: string, base: AdvisorySeverity): AdvisorySeverity {
  const n = name.toLowerCase();
  if (/\bcoming in \d{4}\b/.test(n)) return 'INFO';
  if (/\bclos(ed|ure)\b/.test(n)) return 'CLOSURE';
  if (/\bexit\b/.test(n)) return 'ADVISORY';
  return base;
}

// ── Geometry helpers ────────────────────────────────────────────────

export function rectangleToRing(b: [[number, number], [number, number]]): LatLng[] {
  const [[swLat, swLng], [neLat, neLng]] = b;
  return [
    { lat: swLat, lng: swLng },
    { lat: neLat, lng: swLng },
    { lat: neLat, lng: neLng },
    { lat: swLat, lng: neLng },
  ];
}

export function shapeToRing(shape: C3DShape | null | undefined): LatLng[] | null {
  if (!shape) return null;
  if (shape.type === 'polygon' && Array.isArray(shape.paths) && shape.paths.length >= 3) {
    return shape.paths.map(([lat, lng]) => ({ lat, lng }));
  }
  if (shape.type === 'rectangle' && shape.bounds) {
    return rectangleToRing(shape.bounds);
  }
  return null;
}

interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function ringBBox(ring: LatLng[]): BBox {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return (
    a.minLat <= b.maxLat &&
    a.maxLat >= b.minLat &&
    a.minLng <= b.maxLng &&
    a.maxLng >= b.minLng
  );
}

/** Ray-cast point-in-polygon (lat as Y, lng as X — flat OK at this scale). */
function pointInRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng,
      yi = ring[i].lat;
    const xj = ring[j].lng,
      yj = ring[j].lat;
    const intersect =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function cross(ux: number, uy: number, vx: number, vy: number): number {
  return ux * vy - uy * vx;
}

function segmentsCross(a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean {
  const d1 = cross(d.lng - c.lng, d.lat - c.lat, a.lng - c.lng, a.lat - c.lat);
  const d2 = cross(d.lng - c.lng, d.lat - c.lat, b.lng - c.lng, b.lat - c.lat);
  const d3 = cross(b.lng - a.lng, b.lat - a.lat, c.lng - a.lng, c.lat - a.lat);
  const d4 = cross(b.lng - a.lng, b.lat - a.lat, d.lng - a.lng, d.lat - a.lat);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/** Polygons overlap iff any vertex is inside the other or any edges cross. */
export function ringsOverlap(a: LatLng[], b: LatLng[]): boolean {
  if (!bboxesOverlap(ringBBox(a), ringBBox(b))) return false;
  for (const p of a) if (pointInRing(p, b)) return true;
  for (const p of b) if (pointInRing(p, a)) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// ── Name → lot_id mapper (explicit mentions) ────────────────────────

export function lotIdsFromName(name: string, knownLotIds: Set<string>): string[] {
  const matches = new Set<string>();
  for (const m of name.matchAll(/Lot\s+([A-Z]+\d+)\b/gi)) {
    matches.add(m[1].toUpperCase());
  }
  for (const m of name.matchAll(/\b([EG]\d{1,2}|R\d)\b/g)) {
    matches.add(m[1].toUpperCase());
  }
  if (/pyramid parking structure/i.test(name)) matches.add('PYR');
  if (/palo verde north/i.test(name)) matches.add('PVN');
  if (/palo verde south/i.test(name)) matches.add('PVS');
  return [...matches].filter((id) => knownLotIds.has(id));
}

// ── Main extractor ──────────────────────────────────────────────────

export interface ExtractStats {
  candidateCount: number;
  markerCount: number;
  polylineSkipped: number;
  unmatched: number;
}

export interface ExtractResult {
  seeds: AdvisorySeed[];
  stats: ExtractStats;
}

export function extractLotAdvisories(
  items: C3DLocation[],
  lots: LotPolygon[],
): ExtractResult {
  const candidates = items.filter((i) => i.catId in ADVISORY_CATS);
  const knownLotIds = new Set(lots.map((l) => l.lot_id));
  const seeds: AdvisorySeed[] = [];
  let polylineSkipped = 0;
  let unmatched = 0;

  for (const item of candidates) {
    const ring = shapeToRing(item.shape);
    const meta = ADVISORY_CATS[item.catId];
    const severity = refineSeverity(item.name, meta.severity);
    const nameLots = lotIdsFromName(item.name, knownLotIds);
    const matched = new Set<string>();

    for (const lotId of nameLots) {
      matched.add(lotId);
      seeds.push({
        lot_id: lotId,
        title: item.name.trim(),
        description: null,
        severity,
        source: 'CONCEPT3D',
        source_cat_id: item.catId,
        source_marker_id: item.id,
        match_reason: 'name_mention',
        polygon: ring ?? [],
      });
    }

    if (!ring) {
      if (nameLots.length === 0) polylineSkipped++;
      continue;
    }

    for (const lot of lots) {
      if (matched.has(lot.lot_id)) continue;
      if (ringsOverlap(ring, lot.polygon)) {
        matched.add(lot.lot_id);
        seeds.push({
          lot_id: lot.lot_id,
          title: item.name.trim(),
          description: null,
          severity,
          source: 'CONCEPT3D',
          source_cat_id: item.catId,
          source_marker_id: item.id,
          match_reason: 'polygon_overlap',
          polygon: ring,
        });
      }
    }

    if (matched.size === 0) unmatched++;
  }

  // Deterministic ordering for stable diffs / idempotent upserts.
  seeds.sort(
    (a, b) =>
      a.lot_id.localeCompare(b.lot_id) || a.source_marker_id - b.source_marker_id,
  );

  const stats: ExtractStats = {
    candidateCount: candidates.length,
    markerCount: new Set(seeds.map((s) => s.source_marker_id)).size,
    polylineSkipped,
    unmatched,
  };

  return { seeds, stats };
}
