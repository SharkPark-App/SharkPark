/**
 * Extract lot-affecting advisories (construction zones, road closures,
 * partial closures) from the cached concept3d API and emit a generated
 * dataset that the seeder will upsert into the LotAdvisory table.
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
 *
 * Polylines/markers are skipped (they're navigation hints, not areas
 * that overlap lots — Future U accessible-path detours fall here).
 *
 * Output: prisma/lot-advisories.generated.ts
 *   export const LOT_ADVISORIES: AdvisorySeed[]
 *
 * Run:  pnpm exec ts-node --project tsconfig.scripts.json \
 *         prisma/scripts/extract-lot-advisories.ts
 *
 * Phase F (cron) re-runs this whenever the concept3d cache refreshes.
 * Generated file is committed for deterministic CI.
 */
import * as fs from 'fs';
import * as path from 'path';

import { LOT_GEOFENCES, type LatLng } from '../lot-geofences.generated';

const CONCEPT3D_CACHE = process.env.CONCEPT3D_CACHE_PATH ?? '/tmp/c3d_api.json';
const OUTPUT_PATH = path.join(__dirname, '..', 'lot-advisories.generated.ts');

type Severity = 'INFO' | 'ADVISORY' | 'CLOSURE';

const ADVISORY_CATS: Record<number, { label: string; severity: Severity }> = {
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
 * carrying "Coming in YYYY" / "Future" are forward-looking → INFO.
 */
function refineSeverity(name: string, base: Severity): Severity {
  const n = name.toLowerCase();
  // "Coming in 2026" — forward-looking, not yet impacting parking.
  if (/\bcoming in \d{4}\b/.test(n)) return 'INFO';
  if (/\bclos(ed|ure)\b/.test(n)) return 'CLOSURE';
  if (/\bexit\b/.test(n)) return 'ADVISORY';
  return base;
}

interface C3DShape {
  type: string;
  paths?: [number, number][];
  bounds?: [[number, number], [number, number]];
}

interface C3DLocation {
  id: number;
  catId: number;
  name: string;
  lat: number;
  lng: number;
  shape?: C3DShape | null;
}

// ── Geometry helpers ────────────────────────────────────────────────

function rectangleToRing(b: [[number, number], [number, number]]): LatLng[] {
  const [[swLat, swLng], [neLat, neLng]] = b;
  return [
    { lat: swLat, lng: swLng },
    { lat: neLat, lng: swLng },
    { lat: neLat, lng: neLng },
    { lat: swLat, lng: neLng },
  ];
}

function shapeToRing(shape: C3DShape | null | undefined): LatLng[] | null {
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
  minLat: number; maxLat: number; minLng: number; maxLng: number;
}

function ringBBox(ring: LatLng[]): BBox {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
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
    a.minLat <= b.maxLat && a.maxLat >= b.minLat &&
    a.minLng <= b.maxLng && a.maxLng >= b.minLng
  );
}

/** Ray-cast point-in-polygon (lat treated as Y, lng as X — flat OK at this scale). */
function pointInRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    const intersect =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Two open segments [(x1,y1)-(x2,y2)] and [(x3,y3)-(x4,y4)] strictly cross. */
function segmentsCross(
  a: LatLng, b: LatLng, c: LatLng, d: LatLng,
): boolean {
  const d1 = cross(d.lng - c.lng, d.lat - c.lat, a.lng - c.lng, a.lat - c.lat);
  const d2 = cross(d.lng - c.lng, d.lat - c.lat, b.lng - c.lng, b.lat - c.lat);
  const d3 = cross(b.lng - a.lng, b.lat - a.lat, c.lng - a.lng, c.lat - a.lat);
  const d4 = cross(b.lng - a.lng, b.lat - a.lat, d.lng - a.lng, d.lat - a.lat);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(ux: number, uy: number, vx: number, vy: number): number {
  return ux * vy - uy * vx;
}

/** Polygons overlap iff any vertex is inside the other polygon, or any edges cross. */
function ringsOverlap(a: LatLng[], b: LatLng[]): boolean {
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

function lotIdsFromName(name: string): string[] {
  const matches = new Set<string>();
  // "Lot E10", "Lot G7", "Lot R2", etc.
  for (const m of name.matchAll(/Lot\s+([A-Z]+\d+)\b/gi)) {
    matches.add(m[1].toUpperCase());
  }
  // Bare lot codes like "E10 new exit".
  for (const m of name.matchAll(/\b([EG]\d{1,2}|R\d)\b/g)) {
    matches.add(m[1].toUpperCase());
  }
  if (/pyramid parking structure/i.test(name)) matches.add('PYR');
  if (/palo verde north/i.test(name)) matches.add('PVN');
  if (/palo verde south/i.test(name)) matches.add('PVS');
  // Filter to lots we actually seed.
  return [...matches].filter((id) => id in LOT_GEOFENCES);
}

// ── Main ────────────────────────────────────────────────────────────

interface AdvisorySeed {
  lot_id: string;
  title: string;
  description: string | null;
  severity: Severity;
  source: 'CONCEPT3D';
  source_cat_id: number;
  source_marker_id: number;
  match_reason: 'name_mention' | 'polygon_overlap';
  polygon: LatLng[];
}

function main(): void {
  if (!fs.existsSync(CONCEPT3D_CACHE)) {
    throw new Error(
      `Concept3d cache not found at ${CONCEPT3D_CACHE}. ` +
        `Set CONCEPT3D_CACHE_PATH or refresh the cache first.`,
    );
  }
  const items = JSON.parse(fs.readFileSync(CONCEPT3D_CACHE, 'utf8')) as C3DLocation[];
  const candidates = items.filter((i) => i.catId in ADVISORY_CATS);
  console.log(
    `[advisories] ${candidates.length} concept3d entries across cats ` +
      `${Object.keys(ADVISORY_CATS).join(',')}`,
  );

  const seeds: AdvisorySeed[] = [];
  let polylineSkipped = 0;
  let unmatched = 0;

  for (const item of candidates) {
    const ring = shapeToRing(item.shape);
    const meta = ADVISORY_CATS[item.catId];
    const severity = refineSeverity(item.name, meta.severity);

    // Skip non-polygonal (markers/polylines/labels) — but still attach by
    // explicit name mention so a "Lot E10" label still surfaces.
    const nameLots = lotIdsFromName(item.name);
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

    for (const [lotId, geo] of Object.entries(LOT_GEOFENCES)) {
      if (matched.has(lotId)) continue; // already attached by name
      if (ringsOverlap(ring, geo.polygon)) {
        matched.add(lotId);
        seeds.push({
          lot_id: lotId,
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

  console.log(
    `[advisories] produced ${seeds.length} (lot,advisory) pairs ` +
      `from ${new Set(seeds.map((s) => s.source_marker_id)).size} markers`,
  );
  if (polylineSkipped) {
    console.log(
      `[advisories] ${polylineSkipped} non-polygon entries skipped ` +
        `(polylines/markers with no lot name mention)`,
    );
  }
  if (unmatched) {
    console.log(
      `[advisories] ${unmatched} polygon advisories did not overlap any lot ` +
        `(off-lot construction — informational only, not seeded)`,
    );
  }

  // Pretty print summary by lot.
  const byLot = seeds.reduce<Record<string, AdvisorySeed[]>>((acc, s) => {
    (acc[s.lot_id] ??= []).push(s);
    return acc;
  }, {});
  console.log('\n[advisories] per-lot summary:');
  for (const lotId of Object.keys(byLot).sort()) {
    const list = byLot[lotId];
    console.log(`  ${lotId.padEnd(4)} ${list.length} advisory(ies)`);
    for (const s of list) {
      console.log(`    - [${s.severity}] (${s.match_reason}) ${s.title}`);
    }
  }

  // Sort for deterministic output.
  seeds.sort((a, b) =>
    a.lot_id.localeCompare(b.lot_id) ||
    a.source_marker_id - b.source_marker_id,
  );

  const banner = `// AUTO-GENERATED by prisma/scripts/extract-lot-advisories.ts — DO NOT EDIT.
// Re-run the extractor after refreshing /tmp/c3d_api.json.
// Source: concept3d map 1314 (CSULB).

import type { LatLng } from './lot-geofences.generated';

export type AdvisorySeed = {
  lot_id: string;
  title: string;
  description: string | null;
  severity: 'INFO' | 'ADVISORY' | 'CLOSURE';
  source: 'CONCEPT3D';
  source_cat_id: number;
  source_marker_id: number;
  match_reason: 'name_mention' | 'polygon_overlap';
  polygon: LatLng[];
};

export const LOT_ADVISORIES: AdvisorySeed[] = ${JSON.stringify(seeds, null, 2)};
`;
  fs.writeFileSync(OUTPUT_PATH, banner, 'utf8');
  console.log(`\n[advisories] wrote ${OUTPUT_PATH}`);
}

main();
