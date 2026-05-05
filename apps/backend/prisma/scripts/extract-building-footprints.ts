/**
 * Extract authoritative building footprint polygons from concept3d cached API.
 *
 * Reads /tmp/c3d_api.json (concept3d /locations dump for CSULB map 1314) and
 * emits TWO generated files:
 *   - apps/backend/prisma/building-footprints.generated.ts (consumed by seed)
 *   - apps/mobile/src/data/buildingPolygons.generated.ts   (dev map overlay)
 *
 * Match strategy:
 *   - Whitelist building catIds: 88938, 46533, 37104, 41592 (annotation/route
 *     layers excluded). All four catIds are name-keyed building footprints;
 *     duplicates across catIds are resolved by taking the largest-area ring.
 *   - Match `BuildingSeed.name` and `alternate_names` against canonicalised
 *     concept3d `name`. Canonicalisation strips trailing "(ACR)" and
 *     "- ACR" suffixes and lowercases.
 *
 * Validation:
 *   - Centroid drift between extracted polygon and `BuildingSeed.lat/lng`
 *     must be ≤ CENTROID_DRIFT_MAX_M. Exceeding → throw (mismatched concept3d
 *     entry; fix coords or alternate_names). NO graceful skip.
 *   - Buildings without ANY polygon match are emitted as `null` entries.
 *     This is expected for some CSULB POIs (e.g. Library, Pyramid don't have
 *     polygons in the cache; outdoor spaces; off-campus venues). Production
 *     code falls back to centroid + haversine when footprint is null.
 *
 * Usage (from apps/backend):
 *   pnpm exec ts-node --project tsconfig.scripts.json prisma/scripts/extract-building-footprints.ts
 */
import * as fs from 'fs';
import * as path from 'path';

import { CSULB_BUILDINGS, type BuildingSeed } from '../lot-data';
import { haversineMeters } from '../../src/lots/derive-lot-buildings';

const CONCEPT3D_CACHE = process.env.CONCEPT3D_CACHE_PATH ?? '/tmp/c3d_api.json';
const BACKEND_OUTPUT = path.join(__dirname, '..', 'building-footprints.generated.ts');
const MOBILE_OUTPUT = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'mobile',
  'src',
  'data',
  'buildingPolygons.generated.ts',
);
const CENTROID_DRIFT_MAX_M = 80;

/** concept3d catIds that contain building footprints. Hand-verified against /tmp/c3d_api.json. */
const BUILDING_CAT_IDS = new Set<number>([88938, 46533, 37104, 41592]);

type LatLng = { lat: number; lng: number };

interface C3DShape {
  type: string;
  paths?: [number, number][];
  bounds?: [[number, number], [number, number]];
  position?: [number, number];
}

interface C3DLocation {
  catId: number;
  name: string;
  lat: number;
  lng: number;
  shape?: C3DShape | null;
}

function rectangleToRing(bounds: [[number, number], [number, number]]): LatLng[] {
  const [[swLat, swLng], [neLat, neLng]] = bounds;
  return [
    { lat: swLat, lng: swLng },
    { lat: neLat, lng: swLng },
    { lat: neLat, lng: neLng },
    { lat: swLat, lng: neLng },
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

function ringAreaM2(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
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

function ringCentroid(ring: LatLng[]): LatLng {
  const sum = ring.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
}

/** Normalise a building name for matching. */
function canon(name: string): string {
  return name
    .replace(/\s*\(([^)]+)\)\s*$/, '')   // trailing "(ACR)"
    .replace(/\s*-\s*[A-Z0-9]{1,6}\s*$/, '')  // trailing "- ACR"
    .replace(/\s+(building|bldg|center)\s*$/i, '')  // common suffix variants
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Detect concept3d "cluster" polygons that wrap multiple buildings into one
 * shape (we can't safely attribute a cluster footprint to any single building).
 * Examples:
 *   "Engineering 2, 3, & 4 (EN2, EN3, & EN3) / Vivian Engineering Center (VEC)"
 *   "Health & Human Services 2 (HHS2) / Outpost (OP) / Social Science/Public Affairs (SSPA)"
 *   "Liberal Arts 1 & 2 (LA1 & LA2)"
 */
function isClusterName(name: string): boolean {
  if (/\s\/\s/.test(name)) return true;          // "/" separator
  if (/^Copy of /i.test(name)) return true;       // duplicates
  // Multiple parenthesised acronym groups → cluster.
  const acronymGroups = name.match(/\(([^)]+)\)/g) ?? [];
  for (const g of acronymGroups) {
    if (/[,&]/.test(g)) return true;              // "(EN2, EN3, & EN4)" / "(LA1 & LA2)"
  }
  // Comma-joined ranges before the acronym, e.g. "Engineering 2, 3, & 4".
  if (/\d,\s*\d/.test(name)) return true;
  return false;
}

/** Extract trailing acronym, e.g. "Brotman Hall (BH)" → "BH". */
function extractAcronym(name: string): string | null {
  const m = name.match(/\(([A-Z0-9]{1,6})\)\s*$/);
  return m ? m[1] : null;
}

interface ExtractedFootprint {
  name: string;
  source: { catId: number; name: string };
  polygon: LatLng[];
  centroid: LatLng;
  centroid_drift_m: number;
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
  console.log(`[extract-buildings] loaded ${items.length} concept3d locations`);

  // Index polygon-bearing building entries by canonicalised name + by trailing
  // acronym. Cluster polygons (multi-building shapes) are excluded — they
  // can't be safely attributed to a single building.
  const polysByCanon = new Map<string, { c: C3DLocation; ring: LatLng[] }[]>();
  const polysByAcronym = new Map<string, { c: C3DLocation; ring: LatLng[] }[]>();
  for (const loc of items) {
    if (!BUILDING_CAT_IDS.has(loc.catId)) continue;
    if (!loc.shape) continue;
    if (isClusterName(loc.name)) continue;
    const ring = shapeToRing(loc.shape);
    if (!ring || ring.length < 3) continue;
    const key = canon(loc.name);
    const list = polysByCanon.get(key) ?? [];
    list.push({ c: loc, ring });
    polysByCanon.set(key, list);
    const acr = extractAcronym(loc.name);
    if (acr) {
      const al = polysByAcronym.get(acr) ?? [];
      al.push({ c: loc, ring });
      polysByAcronym.set(acr, al);
    }
  }
  console.log(
    `[extract-buildings] indexed ${[...polysByCanon.values()].reduce((n, l) => n + l.length, 0)} ` +
      `building polygons across ${polysByCanon.size} canonical names ` +
      `and ${polysByAcronym.size} acronyms (clusters excluded)`,
  );

  const matched: ExtractedFootprint[] = [];
  const unmatched: BuildingSeed[] = [];
  const errors: string[] = [];

  for (const b of CSULB_BUILDINGS as readonly BuildingSeed[]) {
    const nameKeys = new Set<string>([canon(b.name), ...b.alternate_names.map(canon)]);
    let bestList: { c: C3DLocation; ring: LatLng[] }[] | null = null;
    let matchVia: 'name' | 'acronym' = 'name';

    for (const k of nameKeys) {
      const hit = polysByCanon.get(k);
      if (hit && hit.length > 0) {
        bestList = hit;
        break;
      }
    }

    // Fallback: match by acronym extracted from concept3d name.
    // We treat any uppercase-only alternate_name (≤6 chars) as an acronym candidate.
    if (!bestList) {
      for (const alt of b.alternate_names) {
        if (!/^[A-Z0-9]{1,6}$/.test(alt)) continue;
        const hit = polysByAcronym.get(alt);
        if (hit && hit.length > 0) {
          bestList = hit;
          matchVia = 'acronym';
          break;
        }
      }
    }

    if (!bestList) {
      unmatched.push(b);
      continue;
    }

    bestList = [...bestList].sort((a, z) => ringAreaM2(z.ring) - ringAreaM2(a.ring));
    const winner = bestList[0];
    const centroid = ringCentroid(winner.ring);
    const drift = haversineMeters({ lat: b.lat, lng: b.lng }, centroid);

    if (drift > CENTROID_DRIFT_MAX_M) {
      errors.push(
        `${b.name}: extracted polygon centroid drifts ${drift.toFixed(1)}m from BuildingSeed (max ${CENTROID_DRIFT_MAX_M}m). ` +
          `Source: catId=${winner.c.catId} "${winner.c.name}" (matched via ${matchVia}). ` +
          `Either BuildingSeed coords are wrong, alternate_names is matching the wrong concept3d entry, or this building genuinely lacks a footprint and should be excluded.`,
      );
      continue;
    }

    matched.push({
      name: b.name,
      source: { catId: winner.c.catId, name: winner.c.name },
      polygon: winner.ring,
      centroid,
      centroid_drift_m: Math.round(drift * 10) / 10,
      vertex_count: winner.ring.length,
    });
  }

  if (errors.length > 0) {
    console.error('\n[extract-buildings] FAILED — drift errors must be resolved (no graceful skip):');
    for (const e of errors) console.error('  ✗ ' + e);
    process.exit(1);
  }

  matched.sort((a, b) => a.name.localeCompare(b.name));

  // ── Backend generated file (full polygon + provenance) ──
  const matchedTs = matched
    .map((r) => {
      const verts = r.polygon
        .map((p) => `      { lat: ${p.lat}, lng: ${p.lng} },`)
        .join('\n');
      return `  ${JSON.stringify(r.name)}: {
    name: ${JSON.stringify(r.name)},
    source: { catId: ${r.source.catId}, name: ${JSON.stringify(r.source.name)} },
    centroid: { lat: ${r.centroid.lat}, lng: ${r.centroid.lng} },
    centroid_drift_m: ${r.centroid_drift_m},
    polygon: [
${verts}
    ],
  },`;
    })
    .join('\n');

  const backendBanner = `// AUTO-GENERATED by prisma/scripts/extract-building-footprints.ts — DO NOT EDIT.
// Re-run the extractor after refreshing /tmp/c3d_api.json.
// Source: concept3d map 1314 (CSULB).

export type LatLng = { lat: number; lng: number };

export type BuildingFootprint = {
  name: string;
  /** Concept3d source provenance (debugging / drift detection). */
  source: { catId: number; name: string };
  /** Outer perimeter ring; closed implicitly (first vertex != last). */
  polygon: LatLng[];
  /** Geometric centroid of the ring (mean of vertices). */
  centroid: LatLng;
  /** Distance (m) from BuildingSeed.lat/lng to centroid at extraction time. */
  centroid_drift_m: number;
};

/**
 * Map of building canonical name (matches BuildingSeed.name) → footprint, or
 * \`null\` when no concept3d polygon is available. Consumers must fall back to
 * centroid haversine distance when the value is null.
 */
export const BUILDING_FOOTPRINTS: Record<string, BuildingFootprint | null> = {
`;

  const backendFooter = '\n};\n';

  // Include null entries so consumers can iterate authoritatively over CSULB_BUILDINGS keys.
  const unmatchedTs = unmatched
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => `  ${JSON.stringify(b.name)}: null,`)
    .join('\n');

  fs.writeFileSync(
    BACKEND_OUTPUT,
    backendBanner + matchedTs + (unmatchedTs ? '\n' + unmatchedTs : '') + backendFooter,
  );

  // ── Mobile generated file (lighter — just name + polygon for dev overlay) ──
  const mobileBody = matched
    .map((r) => {
      const verts = r.polygon
        .map((p) => `      { lat: ${p.lat}, lng: ${p.lng} },`)
        .join('\n');
      return `  {
    name: ${JSON.stringify(r.name)},
    polygon: [
${verts}
    ],
  },`;
    })
    .join('\n');

  const mobileBanner = `// AUTO-GENERATED by apps/backend/prisma/scripts/extract-building-footprints.ts — DO NOT EDIT.
// Dev-only: rendered as polygon overlays in GeofenceDebugScreen.
// Production code should query the API for footprints when needed.

export type LatLng = { lat: number; lng: number };

export interface BuildingPolygon {
  name: string;
  polygon: LatLng[];
}

export const CSULB_BUILDING_POLYGONS: readonly BuildingPolygon[] = [
`;

  fs.writeFileSync(MOBILE_OUTPUT, mobileBanner + mobileBody + '\n] as const;\n');

  // ── Report ──
  console.log(`\n[extract-buildings] wrote ${matched.length} footprints → ${BACKEND_OUTPUT}`);
  console.log(`[extract-buildings] wrote ${matched.length} polygons   → ${MOBILE_OUTPUT}`);
  console.log(
    `[extract-buildings] coverage: ${matched.length} / ${CSULB_BUILDINGS.length} ` +
      `(${unmatched.length} without polygons — fall back to centroid)`,
  );
  if (unmatched.length > 0) {
    console.log('[extract-buildings] no footprint available for:');
    for (const b of unmatched) console.log(`  · ${b.name}`);
  }
  console.log('[extract-buildings] matched (drift in m):');
  for (const r of matched) {
    console.log(
      `  ${r.name.padEnd(48)} ${String(r.vertex_count).padStart(3)} verts  drift=${String(r.centroid_drift_m).padStart(5)}m  ← ${r.source.name} (catId=${r.source.catId})`,
    );
  }
}

main();
