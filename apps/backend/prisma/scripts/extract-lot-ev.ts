/**
 * Extracts EV-charging "presence" facts from the cached concept3d API and
 * reconciles them against the curated `LotSeed.ev_charging_stations` values.
 *
 * Concept3d catIds 41613 ("Electric Vehicle Charging") and 77326 (an alias
 * under a different parent) carry one entry per *charger group / location*,
 * not per stall. Curated values count individual stalls, so we cannot
 * substitute one for the other; we reconcile by **presence** only:
 *
 *   - For every lot with a concept3d EV entry, curated count MUST be > 0.
 *   - Missing concept3d evidence for a curated EV lot is logged as a
 *     soft warning (concept3d may simply lack the marker).
 *   - Concept3d markers referencing lots not in our seed (e.g. R2) are
 *     surfaced too, in case a lot is missing from the seed.
 *
 * Output: `prisma/lot-ev-presence.generated.ts`
 *   export const LOT_EV_PRESENCE: Record<string, EvPresence>
 *
 * Run with: `pnpm exec ts-node --project tsconfig.scripts.json
 *            prisma/scripts/extract-lot-ev.ts`
 */
import * as fs from 'fs';
import * as path from 'path';

import { parkingLots } from '../lot-data';

const CONCEPT3D_CACHE = process.env.CONCEPT3D_CACHE_PATH ?? '/tmp/c3d_api.json';
const OUTPUT_PATH = path.join(__dirname, '..', 'lot-ev-presence.generated.ts');
const EV_CAT_IDS = new Set([41613, 77326]);

interface C3DLocation {
  catId: number;
  name: string;
  lat: number;
  lng: number;
  id: number;
}

interface EvPresence {
  lot_id: string;
  /** Distinct concept3d marker IDs for this lot (deduped across cats 41613/77326). */
  concept3d_marker_ids: number[];
  /** Distinct concept3d marker names (for human inspection). */
  concept3d_marker_names: string[];
}

/**
 * Map a concept3d EV-marker name back to a CSULB lot_id.
 * Names follow patterns like "Lot G7 EV Charging", "Pyramid Parking
 * Structure EV Charging", "Palo Verde South EV Charging".
 */
function lotIdFromMarkerName(name: string): string | null {
  const m1 = name.match(/Lot\s+([A-Z]+\d+)\b/i);
  if (m1) return m1[1].toUpperCase();
  if (/pyramid/i.test(name)) return 'PYR';
  if (/palo verde north/i.test(name)) return 'PVN';
  if (/palo verde south/i.test(name)) return 'PVS';
  return null;
}

function main(): void {
  if (!fs.existsSync(CONCEPT3D_CACHE)) {
    throw new Error(
      `Concept3d cache not found at ${CONCEPT3D_CACHE}. ` +
        `Set CONCEPT3D_CACHE_PATH or refresh the cache first.`,
    );
  }
  const items = JSON.parse(fs.readFileSync(CONCEPT3D_CACHE, 'utf8')) as C3DLocation[];
  const evItems = items.filter((i) => EV_CAT_IDS.has(i.catId));
  console.log(`[ev-extract] ${evItems.length} EV markers across cats ${[...EV_CAT_IDS].join(',')}`);

  const presenceByLot = new Map<string, EvPresence>();
  const unmappedNames: string[] = [];

  for (const item of evItems) {
    const lotId = lotIdFromMarkerName(item.name);
    if (!lotId) {
      unmappedNames.push(item.name);
      continue;
    }
    const existing = presenceByLot.get(lotId) ?? {
      lot_id: lotId,
      concept3d_marker_ids: [],
      concept3d_marker_names: [],
    };
    if (!existing.concept3d_marker_ids.includes(item.id)) {
      existing.concept3d_marker_ids.push(item.id);
    }
    if (!existing.concept3d_marker_names.includes(item.name)) {
      existing.concept3d_marker_names.push(item.name);
    }
    presenceByLot.set(lotId, existing);
  }

  if (unmappedNames.length) {
    throw new Error(
      `Could not map ${unmappedNames.length} EV marker(s) to a lot_id: ` +
        unmappedNames.join(' | '),
    );
  }

  // ── Reconcile against curated LotSeed.ev_charging_stations ──────────
  const curatedById = new Map(parkingLots.map((l) => [l.lot_id, l]));
  const allLotIds = new Set<string>([
    ...curatedById.keys(),
    ...presenceByLot.keys(),
  ]);

  const mismatches: string[] = [];
  console.log('\n[ev-reconcile] curated stalls vs concept3d marker count:');
  for (const lotId of [...allLotIds].sort()) {
    const curated = curatedById.get(lotId);
    const presence = presenceByLot.get(lotId);
    const stalls = curated?.ev_charging_stations ?? null;
    const markers = presence?.concept3d_marker_ids.length ?? 0;
    const inSeed = curated !== undefined;

    if (!inSeed) {
      // Concept3d references a lot we don't seed (e.g. R2). Warn only.
      mismatches.push(
        `  ⚠ ${lotId.padEnd(4)} concept3d=${markers} marker(s) but lot is not in seed`,
      );
      continue;
    }
    if (markers > 0 && (stalls ?? 0) === 0) {
      // Hard mismatch: concept3d says chargers exist, curated says zero.
      mismatches.push(
        `  ✗ ${lotId.padEnd(4)} concept3d=${markers} marker(s) but curated stalls=0`,
      );
      continue;
    }
    if (markers === 0 && (stalls ?? 0) > 0) {
      // Soft mismatch: curated has stalls but concept3d has no marker.
      mismatches.push(
        `  ⚠ ${lotId.padEnd(4)} curated stalls=${stalls} but no concept3d marker`,
      );
      continue;
    }
    if (markers > 0) {
      console.log(
        `  ✓ ${lotId.padEnd(4)} curated stalls=${stalls}, concept3d markers=${markers}`,
      );
    }
  }
  if (mismatches.length) {
    console.log('\n[ev-reconcile] discrepancies (review manually, do not auto-overwrite):');
    for (const m of mismatches) console.log(m);
  }

  // Hard-fail only on the clear contradiction: concept3d marker present
  // but curated count is zero AND lot is in seed. (R2-not-in-seed is a
  // soft warning since lot coverage may legitimately differ.)
  const hardMismatch = mismatches.some((m) => m.startsWith('  ✗'));
  if (hardMismatch) {
    throw new Error(
      '[ev-reconcile] At least one curated lot has zero ev_charging_stations ' +
        'while concept3d shows EV markers. Update lot-data.ts before regenerating.',
    );
  }

  // ── Emit generated module ───────────────────────────────────────────
  const sortedKeys = [...presenceByLot.keys()].sort();
  const banner = `// AUTO-GENERATED by prisma/scripts/extract-lot-ev.ts — DO NOT EDIT.
// Re-run the extractor after refreshing /tmp/c3d_api.json.
// Source: concept3d map 1314 (CSULB), catIds 41613 + 77326.

export type EvPresence = {
  lot_id: string;
  concept3d_marker_ids: number[];
  concept3d_marker_names: string[];
};

export const LOT_EV_PRESENCE: Record<string, EvPresence> = {
`;
  let body = '';
  for (const key of sortedKeys) {
    const p = presenceByLot.get(key)!;
    body += `  ${JSON.stringify(key)}: {\n`;
    body += `    lot_id: ${JSON.stringify(p.lot_id)},\n`;
    body += `    concept3d_marker_ids: ${JSON.stringify(p.concept3d_marker_ids)},\n`;
    body += `    concept3d_marker_names: ${JSON.stringify(p.concept3d_marker_names)},\n`;
    body += `  },\n`;
  }
  const footer = `};\n`;
  fs.writeFileSync(OUTPUT_PATH, banner + body + footer, 'utf8');
  console.log(
    `\n[ev-extract] wrote ${OUTPUT_PATH} (${sortedKeys.length} lots with concept3d EV markers)`,
  );
}

main();
