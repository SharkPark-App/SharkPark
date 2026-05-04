/**
 * Monthly cron: reconcile EV charger presence from concept3d API with curated lot metadata.
 *
 * This job does NOT overwrite curated stall counts, but logs discrepancies:
 *   - If concept3d shows EV marker(s) for a lot with ev_charging_stations=0, logs error.
 *   - If curated data has stalls but concept3d has no marker, logs warning.
 *   - If concept3d references a lot not in our seed, logs warning.
 *
 * Mirrors the logic in prisma/scripts/extract-lot-ev.ts, but runs live against the DB.
 */
import { runCronJob } from './_bootstrap';
import { fetchConcept3dLocations } from '../lots/concept3d-client';

const EV_CAT_IDS = new Set([41613, 77326]);

void runCronJob('refresh-lot-metadata', [], async ({ prisma, logger }) => {
  // Only CSULB for now
  const school = await prisma.school.findFirst({ where: { short_name: 'CSULB' }, select: { id: true } });
  if (!school) {
    logger.warn('[refresh-lot-metadata] no CSULB school row found');
    return;
  }

  const lots = await prisma.lot.findMany({
    where: { school_id: school.id },
    select: { id: true, lot_id: true, ev_charging_stations: true },
  });
  const lotsById = new Map(lots.map(l => [l.lot_id, l]));

  const items = await fetchConcept3dLocations();
  const evItems = items.filter(i => EV_CAT_IDS.has(i.catId));
  logger.log(`[refresh-lot-metadata] found ${evItems.length} concept3d EV markers`);

  // Map concept3d EV markers to lot_id
  function lotIdFromMarkerName(name: string): string | null {
    const m1 = name.match(/Lot\s+([A-Z]+\d+)\b/i);
    if (m1) return m1[1].toUpperCase();
    if (/pyramid/i.test(name)) return 'PYR';
    if (/palo verde north/i.test(name)) return 'PVN';
    if (/palo verde south/i.test(name)) return 'PVS';
    return null;
  }

  const presenceByLot = new Map<string, { markerIds: number[]; markerNames: string[] }>();
  for (const item of evItems) {
    const lotId = lotIdFromMarkerName(item.name);
    if (!lotId) {
      logger.warn(`[refresh-lot-metadata] could not map EV marker '${item.name}' to lot_id`);
      continue;
    }
    const entry = presenceByLot.get(lotId) ?? { markerIds: [], markerNames: [] };
    if (!entry.markerIds.includes(item.id)) entry.markerIds.push(item.id);
    if (!entry.markerNames.includes(item.name)) entry.markerNames.push(item.name);
    presenceByLot.set(lotId, entry);
  }

  // Reconcile
  const allLotIds = new Set([...lotsById.keys(), ...presenceByLot.keys()]);
  let errors = 0, warnings = 0;
  for (const lotId of allLotIds) {
    const lot = lotsById.get(lotId);
    const presence = presenceByLot.get(lotId);
    const stalls = lot?.ev_charging_stations ?? null;
    const markers = presence?.markerIds.length ?? 0;
    const inSeed = lot !== undefined;

    if (!inSeed) {
      logger.warn(`[refresh-lot-metadata] concept3d EV marker(s) for unknown lot_id ${lotId}`);
      warnings++;
      continue;
    }
    if (markers > 0 && (stalls ?? 0) === 0) {
      logger.error(`[refresh-lot-metadata] concept3d shows EV marker(s) for ${lotId} but ev_charging_stations=0`);
      errors++;
      continue;
    }
    if (markers === 0 && (stalls ?? 0) > 0) {
      logger.warn(`[refresh-lot-metadata] curated ev_charging_stations=${stalls} for ${lotId} but no concept3d marker`);
      warnings++;
      continue;
    }
    if (markers > 0) {
      logger.log(`[refresh-lot-metadata] ${lotId}: curated stalls=${stalls}, concept3d markers=${markers}`);
    }
  }
  logger.log(`[refresh-lot-metadata] complete: ${errors} error(s), ${warnings} warning(s)`);
});
