/**
 * Visual inspection script: prints derived buildings for every lot.
 *
 * Usage (from apps/backend):
 *   pnpm exec ts-node --project tsconfig.scripts.json prisma/scripts/print-lot-buildings.ts
 *
 * Use this after editing lot coordinates, building coordinates, or
 * `building_overrides` to confirm the geometric derivation looks sensible
 * before running a real seed.
 */
import { CSULB_BUILDINGS, parkingLots } from '../lot-data';
import { BUILDING_FOOTPRINTS } from '../building-footprints.generated';
import { LOT_GEOFENCES } from '../lot-geofences.generated';
import { deriveLotBuildings } from '../../src/lots/derive-lot-buildings';

const RADIUS_M = Number(process.env.LOT_BUILDING_RADIUS_M ?? 250);

const buildingsWithFootprints = CSULB_BUILDINGS.map((b) => ({
  ...b,
  polygon: BUILDING_FOOTPRINTS[b.name]?.polygon ?? null,
}));

console.log(
  `\nDerived lot↔building proximity (radius: ${RADIUS_M} m)\n` +
    '='.repeat(70),
);

for (const lot of parkingLots) {
  const geofence = LOT_GEOFENCES[lot.lot_id];
  if (!geofence) {
    console.log(`\n${lot.lot_id} — ${lot.display_name}\n  (no geofence — skipped)`);
    continue;
  }
  const names = deriveLotBuildings(
    {
      ...lot,
      center_lat: geofence.centroid.lat,
      center_lng: geofence.centroid.lng,
      polygon: geofence.polygon,
    },
    buildingsWithFootprints,
    RADIUS_M,
  );
  const overrideNote = lot.building_overrides
    ? ` [overrides: +${lot.building_overrides.add?.length ?? 0} / -${
        lot.building_overrides.exclude?.length ?? 0
      }]`
    : '';
  console.log(`\n${lot.lot_id} — ${lot.display_name}${overrideNote}`);
  if (names.length === 0) {
    console.log('  (no buildings in range)');
  } else {
    for (const n of names) console.log(`  • ${n}`);
  }
}

console.log(
  `\n${'='.repeat(70)}\nTotal lots: ${parkingLots.length} | Buildings: ${CSULB_BUILDINGS.length}\n`,
);
