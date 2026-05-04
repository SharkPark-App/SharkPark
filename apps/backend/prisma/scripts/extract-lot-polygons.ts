/**
 * Extract authoritative lot perimeter polygons from concept3d cached API.
 *
 * Reads /tmp/c3d_api.json (concept3d /locations dump for CSULB map 1314)
 * and emits prisma/lot-geofences.generated.ts with one record per LotSeed.
 *
 * Preference rules (per lot_id):
 *   - G* → catId 41596 (General Parking)
 *   - E* → catId 41597 (Employee Parking)
 *   - PVN/PVS → catId 41596 (named "Palo Verde {N|S} Parking Structure")
 *   - PYR     → catId 41596 (named "Pyramid Parking Structure", rectangle)
 * If multiple polygons match the same name+catId (rare), pick the largest by area.
 *
 * Validation:
 *   - Every polygon centroid MUST be within CENTROID_DRIFT_MAX_M of the
 *     LotSeed.center_lat/lng. If exceeded → throw (fix LotSeed coords or
 *     update preference for that lot). NO graceful skip — bad data must fail loud.
 *   - Every LotSeed lot_id MUST get a polygon. Missing → throw.
 *
 * Usage (from apps/backend):
 *   pnpm exec ts-node --project tsconfig.scripts.json prisma/scripts/extract-lot-polygons.ts
 *
 * Re-run whenever the concept3d cache is refreshed (Phase F adds a cron).
 * Commit the generated file alongside seed data so CI is deterministic.
 */
import * as fs from 'fs';
import * as path from 'path';

import { parkingLots, type LotSeed } from '../lot-data';
import { haversineMeters } from '../../src/lots/derive-lot-buildings';

const CONCEPT3D_CACHE = process.env.CONCEPT3D_CACHE_PATH ?? '/tmp/c3d_api.json';
const OUTPUT_PATH = path.join(__dirname, '..', 'lot-geofences.generated.ts');
const CENTROID_DRIFT_MAX_M = 100;

type LatLng = { lat: number; lng: number };

/** Concept3d shape variants we care about. */
interface C3DShape {
  type: string;
  paths?: [number, number][];           // polygon: array of [lat,lng]
  bounds?: [[number, number], [number, number]]; // rectangle: SW, NE
  position?: [number, number];
}

interface C3DLocation {
  catId: number;
  name: string;
  lat: number;
  lng: number;
  shape?: C3DShape | null;
}

/** Convert rectangle bounds (SW + NE corners) to a 4-vertex CW ring. */
function rectangleToRing(bounds: [[number, number], [number, number]]): LatLng[] {
  const [[swLat, swLng], [neLat, neLng]] = bounds;
  return [
    { lat: swLat, lng: swLng }, // SW
    { lat: neLat, lng: swLng }, // NW
    { lat: neLat, lng: neLng }, // NE
    { lat: swLat, lng: neLng }, // SE
  ];
}

function shapeToRing(shape: C3DShape): LatLng[] | null {
  if (shape.type === 'polygon' && Array.isArray(shape.paths) && shape.paths.length >= 3) {
    return shape.paths.map(([lat, lng]) => ({ lat, lng }));
  }
  if (shape.type === 'rectangle' && shape.bounds) {
    return rectangleToRing(shape.bounds);
  }
  return null;
}

/**
 * Approximate polygon area in m² using equirectangular projection at the
 * polygon's mean latitude. Plenty accurate for ~100m campus polygons; we
 * only need it to pick the largest among a same-name set.
 */
function ringAreaM2(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  // Convert to local meters.
  const xy = ring.map((p) => ({
    x: p.lng * 111_320 * cosLat,
    y: p.lat * 110_540,
  }));
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    area += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  return Math.abs(area / 2);
}

/** Centroid of a (planar-approx) ring — average of vertices is good enough. */
function ringCentroid(ring: LatLng[]): LatLng {
  const sum = ring.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
}

/** Lookup rule: which (catId, name(s)) to find for a given LotSeed.lot_id. */
function lookupRule(lot: LotSeed): { catId: number; nameCandidates: string[] } {
  const id = lot.lot_id;
  if (id === 'PVN') return { catId: 41596, nameCandidates: ['Palo Verde North Parking Structure'] };
  if (id === 'PVS') return { catId: 41596, nameCandidates: ['Palo Verde South Parking Structure'] };
  if (id === 'PYR') return { catId: 41596, nameCandidates: ['Pyramid Parking Structure'] };
  // G4 is missing from the standard Parking catIds (41596/41597). The only
  // full-footprint polygon for it lives under catId 43985 ("Outdoor WiFi"),
  // which traces each lot's WiFi coverage area = lot perimeter.
  if (id === 'G4') return { catId: 43985, nameCandidates: ['G4'] };
  if (id.startsWith('E')) return { catId: 41597, nameCandidates: [id, id + ' '] };
  if (id.startsWith('G')) return { catId: 41596, nameCandidates: [id, id + ' '] };
  throw new Error(`No concept3d lookup rule for lot_id=${id}`);
}

interface ExtractedGeofence {
  lot_id: string;
  source: { catId: number; name: string };
  polygon: LatLng[];
  centroid: LatLng;
  centroid_drift_m: number;
  /** Max distance (m) from centroid to any vertex + 5 m safety buffer. */
  radius_m: number;
  vertex_count: number;
}

function main(): void {
  if (!fs.existsSync(CONCEPT3D_CACHE)) {
    throw new Error(
      `Concept3d cache not found at ${CONCEPT3D_CACHE}. ` +
        `Set CONCEPT3D_CACHE_PATH or refresh the cache first.`,
    );
  }

  const raw = JSON.parse(fs.readFileSync(CONCEPT3D_CACHE, 'utf8')) as
    | C3DLocation[]
    | { locations: C3DLocation[] };
  const items: C3DLocation[] = Array.isArray(raw) ? raw : raw.locations ?? [];
  console.log(`[extract] loaded ${items.length} concept3d locations`);

  const results: ExtractedGeofence[] = [];
  const errors: string[] = [];

  for (const lot of parkingLots) {
    const rule = lookupRule(lot);
    const candidates = items.filter(
      (i) =>
        i.catId === rule.catId &&
        rule.nameCandidates.some((n) => n.trim() === i.name.trim()),
    );

    if (candidates.length === 0) {
      errors.push(
        `${lot.lot_id}: no concept3d match (catId=${rule.catId}, names=${rule.nameCandidates.join('|')})`,
      );
      continue;
    }

    const rings = candidates
      .map((c) => ({ c, ring: c.shape ? shapeToRing(c.shape) : null }))
      .filter((x): x is { c: C3DLocation; ring: LatLng[] } => x.ring !== null);

    if (rings.length === 0) {
      errors.push(
        `${lot.lot_id}: ${candidates.length} concept3d match(es) but none had usable shape (paths/bounds)`,
      );
      continue;
    }

    // Pick the largest-area ring when multiple match (defensive: in practice
    // each (catId, name) pair has exactly one entry).
    rings.sort((a, b) => ringAreaM2(b.ring) - ringAreaM2(a.ring));
    const winner = rings[0];
    const chosenRing = winner.ring;
    const provenance = { catId: winner.c.catId, name: winner.c.name };

    const centroid = ringCentroid(chosenRing);
    const drift = haversineMeters(
      { lat: lot.center_lat, lng: lot.center_lng },
      centroid,
    );

    if (drift > CENTROID_DRIFT_MAX_M) {
      errors.push(
        `${lot.lot_id}: extracted polygon centroid drifts ${drift.toFixed(1)}m from LotSeed.center (max ${CENTROID_DRIFT_MAX_M}m). ` +
          `Either LotSeed coords are wrong, or the wrong concept3d entry was matched.`,
      );
      continue;
    }

    results.push({
      lot_id: lot.lot_id,
      source: provenance,
      polygon: chosenRing,
      centroid,
      centroid_drift_m: Math.round(drift * 10) / 10,
      radius_m:
        Math.ceil(
          Math.max(...chosenRing.map((v) => haversineMeters(centroid, v))) + 5,
        ),
      vertex_count: chosenRing.length,
    });
  }

  if (errors.length > 0) {
    console.error('\n[extract] FAILED — errors must be resolved (no graceful skip):');
    for (const e of errors) console.error('  ✗ ' + e);
    process.exit(1);
  }

  // Sort for deterministic output (stable diffs).
  results.sort((a, b) => a.lot_id.localeCompare(b.lot_id));

  // Render TS module.
  const banner = `// AUTO-GENERATED by prisma/scripts/extract-lot-polygons.ts — DO NOT EDIT.
// Re-run the extractor after refreshing /tmp/c3d_api.json.
// Source: concept3d map 1314 (CSULB).

// Use type aliases (not interfaces) so these structures satisfy Prisma's
// InputJsonValue constraint without an index signature.
export type LatLng = { lat: number; lng: number };

export type LotGeofence = {
  lot_id: string;
  /** Outer perimeter ring; closed implicitly (first vertex != last). */
  polygon: LatLng[];
  /** Concept3d source provenance (debugging / drift detection). */
  source: { catId: number; name: string };
  /** Geometric centroid of the ring (mean of vertices). */
  centroid: LatLng;
  /** Distance (meters) from LotSeed.center_lat/lng to centroid at extraction time. */
  centroid_drift_m: number;
  /** Bounding-circle radius (m): max(centroid→vertex) + 5 m buffer. */
  radius_m: number;
};

export const LOT_GEOFENCES: Record<string, LotGeofence> = {
`;

  const body = results
    .map((r) => {
      const verts = r.polygon
        .map((p) => `      { lat: ${p.lat}, lng: ${p.lng} },`)
        .join('\n');
      return `  '${r.lot_id}': {
    lot_id: '${r.lot_id}',
    source: { catId: ${r.source.catId}, name: ${JSON.stringify(r.source.name)} },
    centroid: { lat: ${r.centroid.lat}, lng: ${r.centroid.lng} },
    centroid_drift_m: ${r.centroid_drift_m},
    radius_m: ${r.radius_m},
    polygon: [
${verts}
    ],
  },`;
    })
    .join('\n');

  const footer = '\n};\n';

  fs.writeFileSync(OUTPUT_PATH, banner + body + footer);

  console.log(`\n[extract] wrote ${results.length} geofences → ${OUTPUT_PATH}`);
  console.log('[extract] vertex counts & drift:');
  for (const r of results) {
    console.log(
      `  ${r.lot_id.padEnd(4)} ${String(r.vertex_count).padStart(3)} verts  r=${String(r.radius_m).padStart(3)}m  drift=${String(r.centroid_drift_m).padStart(5)}m  ← ${r.source.name} (catId=${r.source.catId})`,
    );
  }

}

main();
