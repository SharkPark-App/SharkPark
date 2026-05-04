/**
 * Weekly cron: refresh `lot_advisories` from the live concept3d API.
 *
 * Geofences and building polygons are committed to the repo (see Phase B/C)
 * because changes to those are rare and warrant a code-review. Construction
 * advisories, by contrast, change weekly during active build-out, so we run
 * the same shared extractor against the live API and write directly to the
 * table.
 *
 * Strategy per school:
 *   1. Fetch all concept3d locations.
 *   2. Load lots from DB (we need their geofence polygons + cuid PKs).
 *   3. Run the shared extractor → AdvisorySeed[].
 *   4. Mark all current CONCEPT3D advisories is_active=false (history
 *      preserved, no deletes).
 *   5. Upsert each seed back to is_active=true, keyed by the composite
 *      unique (school_id, source, source_marker_id, lot_id).
 *
 * Mirrors the seed-prod.ts section-5 logic so dev seed and prod refresh
 * stay in lockstep.
 */
import type { Prisma } from '@prisma/client';

import { runCronJob } from './_bootstrap';
import { fetchConcept3dLocations } from '../lots/concept3d-client';
import {
  extractLotAdvisories,
  type LatLng,
  type LotPolygon,
} from '../lots/lot-advisory-extractor';

void runCronJob('refresh-lot-advisories', [], async ({ prisma, logger }) => {
  // Only CSULB has a concept3d map id wired up today. When we add more
  // schools we'll move the map id onto the School row; until then, scope
  // the refresh to the school whose lots we know match map=1314.
  const schools = await prisma.school.findMany({
    where: { short_name: 'CSULB' },
    select: { id: true, short_name: true },
  });
  if (schools.length === 0) {
    logger.warn('[refresh-lot-advisories] no eligible schools — nothing to do');
    return;
  }

  const items = await fetchConcept3dLocations();
  logger.log(`[refresh-lot-advisories] fetched ${items.length} concept3d locations`);

  for (const school of schools) {
    const lots = await prisma.lot.findMany({
      where: { school_id: school.id },
      select: { id: true, lot_id: true, geofence_polygon: true },
    });

    const lotPolygons: LotPolygon[] = lots.map((l) => ({
      lot_id: l.lot_id,
      polygon: l.geofence_polygon as unknown as LatLng[],
    }));
    const lotIdToCuid = new Map(lots.map((l) => [l.lot_id, l.id]));

    const { seeds, stats } = extractLotAdvisories(items, lotPolygons);
    logger.log(
      `[refresh-lot-advisories] ${school.short_name}: ${stats.candidateCount} ` +
        `concept3d candidates → ${seeds.length} seed rows from ${stats.markerCount} markers`,
    );

    const deactivated = await prisma.lotAdvisory.updateMany({
      where: { school_id: school.id, source: 'CONCEPT3D', is_active: true },
      data: { is_active: false },
    });
    logger.log(
      `[refresh-lot-advisories] ${school.short_name}: deactivated ` +
        `${deactivated.count} prior CONCEPT3D advisory row(s)`,
    );

    let upserted = 0;
    let skipped = 0;
    for (const seed of seeds) {
      const dbLotId = lotIdToCuid.get(seed.lot_id);
      if (!dbLotId) {
        skipped++;
        continue;
      }
      const polygon = seed.polygon as unknown as Prisma.InputJsonValue;
      await prisma.lotAdvisory.upsert({
        where: {
          uq_lot_advisory_source_lot: {
            school_id: school.id,
            source: 'CONCEPT3D',
            source_marker_id: seed.source_marker_id,
            lot_id: dbLotId,
          },
        },
        create: {
          school_id: school.id,
          lot_id: dbLotId,
          title: seed.title,
          description: seed.description,
          severity: seed.severity,
          source: 'CONCEPT3D',
          source_cat_id: seed.source_cat_id,
          source_marker_id: seed.source_marker_id,
          match_reason: seed.match_reason,
          polygon,
          is_active: true,
        },
        update: {
          title: seed.title,
          description: seed.description,
          severity: seed.severity,
          source_cat_id: seed.source_cat_id,
          match_reason: seed.match_reason,
          polygon,
          is_active: true,
        },
      });
      upserted++;
    }

    logger.log(
      `[refresh-lot-advisories] ${school.short_name}: upserted ${upserted} active ` +
        `advisor${upserted === 1 ? 'y' : 'ies'}` +
        (skipped ? ` (${skipped} skipped — unknown lot_id)` : ''),
    );
  }
});
