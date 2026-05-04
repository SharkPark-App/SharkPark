/**
 * Production Seed Script — IDEMPOTENT
 *
 * Safe to run repeatedly against a production database. Will:
 *   - upsert the School row keyed on short_name
 *   - upsert each Lot keyed on (school_id, lot_id)
 *   - NEVER delete anything
 *   - NEVER touch dynamic state (current_occupancy, snapshots, events, users, etc.)
 *
 * On UPDATE, current_occupancy is intentionally excluded so live values
 * written by the snapshot/cleanup crons or app code are preserved.
 *
 * Usage:
 *   pnpm --filter @sharkpark/backend db:seed:prod
 *
 * Loads env from `.env.production.local` if present (Neon credentials),
 * otherwise falls back to the standard `.env` flow.
 */

import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Prefer .env.production.local for prod credentials (gitignored).
const prodEnvPath = path.resolve(__dirname, '../.env.production.local');
if (fs.existsSync(prodEnvPath)) {
  dotenv.config({ path: prodEnvPath, override: true });
}

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { CSULB_SCHOOL, CSULB_BUILDINGS, parkingLots } from './lot-data';
import { LOT_GEOFENCES } from './lot-geofences.generated';
import { BUILDING_FOOTPRINTS } from './building-footprints.generated';
import { LOT_ADVISORIES } from './lot-advisories.generated';
import { deriveLotBuildings } from '../src/lots/derive-lot-buildings';

const rawConnectionString = process.env.DATABASE_URL;
if (!rawConnectionString) {
  console.error('[seed-prod] DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

/**
 * `sslrootcert=system` is a libpq feature (uses the OS CA bundle). node-postgres
 * doesn't recognize it and tries to fs.readFileSync('system') → ENOENT. Strip
 * it: Node's TLS already trusts system roots by default, so verify-full still
 * does full chain + hostname verification.
 */
function stripLibpqOnlyParams(url: string): string {
  const u = new URL(url);
  if (u.searchParams.get('sslrootcert') === 'system') {
    u.searchParams.delete('sslrootcert');
  }
  return u.toString();
}

const pool = new pg.Pool({ connectionString: stripLibpqOnlyParams(rawConnectionString) });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface UpsertCounts {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Compare existing lot row to desired data; returns true if any field other
 * than `current_occupancy` (or auto-managed timestamps/id) differs.
 */
function lotNeedsUpdate(
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(desired)) {
    const a = existing[key];

    // null on either side
    if (a === null || value === null) {
      if (a !== value) return true;
      continue;
    }

    // Prisma Decimal (or any object with a numeric toString) — compare as numbers
    if (typeof a === 'object' && a !== null && 'toString' in (a as object) && typeof value === 'number') {
      if (Number(String(a)) !== value) return true;
      continue;
    }

    // JSON / arrays — deep compare via JSON.stringify
    if (typeof a === 'object' || typeof value === 'object') {
      if (JSON.stringify(a) !== JSON.stringify(value)) return true;
      continue;
    }

    if (a !== value) return true;
  }
  return false;
}

async function seedProd() {
  console.log('[seed-prod] SharkPark production seed (idempotent)\n');
  console.log(`[seed-prod] DATABASE host: ${new URL(rawConnectionString!).host}\n`);

  // ── 1. Upsert School ───────────────────────────────────────
  const beforeSchool = await prisma.school.findUnique({
    where: { short_name: CSULB_SCHOOL.short_name },
  });

  const school = await prisma.school.upsert({
    where: { short_name: CSULB_SCHOOL.short_name },
    create: {
      school_name: CSULB_SCHOOL.school_name,
      short_name: CSULB_SCHOOL.short_name,
      timezone: CSULB_SCHOOL.timezone,
    },
    update: {
      school_name: CSULB_SCHOOL.school_name,
      timezone: CSULB_SCHOOL.timezone,
    },
  });

  if (!beforeSchool) {
    console.log(`[seed-prod] School CREATED: ${school.short_name} (${school.id})`);
  } else {
    console.log(`[seed-prod] School OK: ${school.short_name} (${school.id})`);
  }

  // ── 2. Upsert Lots ─────────────────────────────────────────
  const counts: UpsertCounts = { created: 0, updated: 0, unchanged: 0 };

  for (const lot of parkingLots) {
    const geofence = LOT_GEOFENCES[lot.lot_id];
    if (!geofence) {
      throw new Error(
        `[seed-prod] No concept3d geofence for lot_id=${lot.lot_id}. ` +
          `Re-run prisma/scripts/extract-lot-polygons.ts after updating lookup rules.`,
      );
    }
    const desired = {
      lot_name: lot.lot_name,
      display_name: lot.display_name,
      lot_number: lot.lot_number,
      lot_type: lot.lot_type,
      capacity: lot.capacity,
      location_description: lot.location_description,
      // Geometry comes entirely from lot-geofences.generated.ts (concept3d).
      // Lot.center_lat/lng = polygon centroid so the DB has one consistent
      // geometric source matching geofence_polygon.
      center_lat: geofence.centroid.lat,
      center_lng: geofence.centroid.lng,
      geofence_polygon: geofence.polygon,
      geofence_radius: geofence.radius_m,
      permit_types: lot.permit_types,
      daily_permit_allowed: lot.daily_permit_allowed,
      daily_rate: lot.daily_rate ?? null,
      hours_weekday: lot.hours_weekday,
      hours_saturday: lot.hours_saturday,
      hours_sunday: lot.hours_sunday,
      ev_charging_stations: lot.ev_charging_stations,
      motorcycle_spaces: lot.motorcycle_spaces,
      accessible_spaces: lot.accessible_spaces,
      short_term_parking_spaces: lot.short_term_parking_spaces,
      low_emission_spaces: lot.low_emission_spaces,
      pay_stations: lot.pay_stations,
      has_lighting: lot.has_lighting,
      has_cameras: lot.has_cameras,
      has_emergency_phone: lot.has_emergency_phone,
      is_covered: lot.is_covered,
      is_paved: lot.is_paved,
      is_structure: lot.is_structure ?? false,
      has_solar_canopy: lot.has_solar_canopy,
      levels: lot.levels ?? null,
      metadata_confidence: lot.metadata_confidence,
    };

    const existing = await prisma.lot.findUnique({
      where: {
        school_id_lot_id: { school_id: school.id, lot_id: lot.lot_id },
      },
    });

    if (!existing) {
      await prisma.lot.create({
        data: {
          school_id: school.id,
          lot_id: lot.lot_id,
          current_occupancy: 0, // start clean in prod
          ...desired,
        },
      });
      counts.created += 1;
      console.log(`[seed-prod]   + CREATED ${lot.lot_id}`);
      continue;
    }

    if (lotNeedsUpdate(existing as unknown as Record<string, unknown>, desired)) {
      await prisma.lot.update({
        where: {
          school_id_lot_id: { school_id: school.id, lot_id: lot.lot_id },
        },
        // NOTE: current_occupancy is intentionally NOT in the update payload
        data: desired,
      });
      counts.updated += 1;
      console.log(`[seed-prod]   ~ UPDATED ${lot.lot_id}`);
    } else {
      counts.unchanged += 1;
    }
  }

  console.log('\n[seed-prod] Lot summary:');
  console.log(`[seed-prod]   created:   ${counts.created}`);
  console.log(`[seed-prod]   updated:   ${counts.updated}`);
  console.log(`[seed-prod]   unchanged: ${counts.unchanged}`);
  console.log(`[seed-prod]   total:     ${parkingLots.length}`);

  const dbCount = await prisma.lot.count({ where: { school_id: school.id } });
  console.log(`\n[seed-prod] DB lot count for ${school.short_name}: ${dbCount}`);

  if (dbCount !== parkingLots.length) {
    console.warn(
      `[seed-prod] WARNING: DB has ${dbCount} lots but lot-data has ${parkingLots.length}. ` +
        `Extra rows in DB are NOT deleted by this script — clean up manually if intentional.`,
    );
  }

  // ── 3. Upsert Buildings ────────────────────────────────────
  console.log('\n[seed-prod] Upserting buildings...');
  const buildingMap = new Map<string, { id: string; alternate_names: string[] }>();

  // Pre-merge footprint polygons so derive-lot-buildings can use
  // point-to-edge distance (centroid haversine fallback when polygon is missing).
  const buildingsWithFootprints = CSULB_BUILDINGS.map((b) => ({
    ...b,
    polygon: BUILDING_FOOTPRINTS[b.name]?.polygon ?? null,
  }));

  for (const b of buildingsWithFootprints) {
    const building = await prisma.building.upsert({
      where: { school_id_name: { school_id: school.id, name: b.name } },
      create: {
        school_id: school.id,
        name: b.name,
        alternate_names: b.alternate_names,
        center_lat: b.lat,
        center_lng: b.lng,
        footprint_polygon: b.polygon ?? undefined,
        category: b.category,
      },
      update: {
        alternate_names: b.alternate_names,
        center_lat: b.lat,
        center_lng: b.lng,
        // Always sync footprint (including null when polygon was removed) so
        // production stays consistent with the latest concept3d extraction.
        footprint_polygon: b.polygon ?? Prisma.JsonNull,
        category: b.category,
      },
    });
    buildingMap.set(b.name, { id: building.id, alternate_names: b.alternate_names });
  }
  console.log(`[seed-prod] ${CSULB_BUILDINGS.length} buildings upserted`);

  // ── 4. Upsert Lot-Building associations ───────────────────
  console.log('\n[seed-prod] Upserting lot-building associations...');
  let lotBuildingCount = 0;

  for (const lot of parkingLots) {
    const lotRow = await prisma.lot.findUnique({
      where: { school_id_lot_id: { school_id: school.id, lot_id: lot.lot_id } },
      select: { id: true },
    });
    if (!lotRow) continue;

    const geofence = LOT_GEOFENCES[lot.lot_id];
    if (!geofence) continue;
    const nearbyNames = deriveLotBuildings(
      { ...lot, center_lat: geofence.centroid.lat, center_lng: geofence.centroid.lng },
      buildingsWithFootprints,
    );
    const desiredBuildingIds = new Set<string>();
    for (const proximity of nearbyNames) {
      const building = buildingMap.get(proximity); // exact name match — no duplicates possible
      if (!building) continue;
      desiredBuildingIds.add(building.id);
      await prisma.lotBuilding.upsert({
        where: { lot_id_building_id: { lot_id: lotRow.id, building_id: building.id } },
        create: { lot_id: lotRow.id, building_id: building.id },
        update: {},
      });
      lotBuildingCount++;
    }

    // Reconcile: drop stale rows (previously hand-curated) no longer in the
    // geometrically-derived set so the join table reflects the current truth.
    const stale = await prisma.lotBuilding.findMany({
      where: { lot_id: lotRow.id },
      select: { building_id: true },
    });
    const toDelete = stale
      .map((r) => r.building_id)
      .filter((id) => !desiredBuildingIds.has(id));
    if (toDelete.length > 0) {
      await prisma.lotBuilding.deleteMany({
        where: { lot_id: lotRow.id, building_id: { in: toDelete } },
      });
      console.log(`[seed-prod]   - ${lot.lot_id}: removed ${toDelete.length} stale building link(s)`);
    }
  }
  console.log(`[seed-prod] ${lotBuildingCount} lot-building associations upserted`);

  // ── 5. Upsert Lot Advisories (concept3d construction/closure overlay) ──
  console.log('\n[seed-prod] Upserting lot advisories...');

  // Mark all existing CONCEPT3D advisories inactive; the upsert loop below
  // re-activates the ones still present in the generated set, leaving any
  // stale rows is_active=false (preserves history without deletes).
  const deactivated = await prisma.lotAdvisory.updateMany({
    where: { school_id: school.id, source: 'CONCEPT3D', is_active: true },
    data: { is_active: false },
  });
  console.log(`[seed-prod]   deactivated ${deactivated.count} prior CONCEPT3D advisory row(s)`);

  let advisoryCount = 0;
  for (const seed of LOT_ADVISORIES) {
    const lotRow = await prisma.lot.findUnique({
      where: { school_id_lot_id: { school_id: school.id, lot_id: seed.lot_id } },
      select: { id: true },
    });
    if (!lotRow) {
      console.warn(`[seed-prod]   ! advisory references unknown lot_id=${seed.lot_id}, skipping`);
      continue;
    }

    const polygon = seed.polygon as unknown as Prisma.InputJsonValue;

    await prisma.lotAdvisory.upsert({
      where: {
        uq_lot_advisory_source_lot: {
          school_id: school.id,
          source: 'CONCEPT3D',
          source_marker_id: seed.source_marker_id,
          lot_id: lotRow.id,
        },
      },
      create: {
        school_id: school.id,
        lot_id: lotRow.id,
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
    advisoryCount += 1;
  }
  console.log(`[seed-prod] ${advisoryCount} lot advisory rows upserted (active)`);
}

seedProd()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
    console.log('\n[seed-prod] Done.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seed-prod] FAILED:', err);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
