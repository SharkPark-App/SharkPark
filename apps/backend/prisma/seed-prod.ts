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

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { CSULB_SCHOOL, CSULB_BUILDINGS, GEOFENCE_POLYGONS, generateGeofence, parkingLots } from './lot-data';

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
    const desired = {
      lot_name: lot.lot_name,
      display_name: lot.display_name,
      lot_number: lot.lot_number,
      lot_type: lot.lot_type,
      capacity: lot.capacity,
      location_description: lot.location_description,
      center_lat: lot.center_lat,
      center_lng: lot.center_lng,
      geofence_polygon:
        GEOFENCE_POLYGONS[lot.lot_id] ??
        generateGeofence(lot.center_lat, lot.center_lng, lot.geofence_radius),
      geofence_radius: lot.geofence_radius,
      permit_types: lot.permit_types,
      daily_permit_allowed: lot.daily_permit_allowed,
      daily_rate: lot.daily_rate ?? null,
      hours_weekday: lot.hours_weekday,
      hours_saturday: lot.hours_saturday,
      hours_sunday: lot.hours_sunday,
      ev_charging_stations: lot.ev_charging_stations,
      motorcycle_spaces: lot.motorcycle_spaces,
      accessible_spaces: lot.accessible_spaces,
      has_lighting: lot.has_lighting,
      has_cameras: lot.has_cameras,
      has_emergency_phone: lot.has_emergency_phone,
      is_covered: lot.is_covered,
      is_paved: lot.is_paved,
      levels: lot.levels ?? null,
      penetration_rate: lot.penetration_rate,
      avg_turnover_minutes: lot.avg_turnover_minutes,
      confidence: lot.confidence,
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

  for (const b of CSULB_BUILDINGS) {
    const building = await prisma.building.upsert({
      where: { school_id_name: { school_id: school.id, name: b.name } },
      create: { school_id: school.id, name: b.name, alternate_names: b.alternate_names },
      update: { alternate_names: b.alternate_names },
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

    for (const proximity of lot.buildings) {
      const building = buildingMap.get(proximity); // exact name match — no duplicates possible
      if (!building) continue;
      await prisma.lotBuilding.upsert({
        where: { lot_id_building_id: { lot_id: lotRow.id, building_id: building.id } },
        create: { lot_id: lotRow.id, building_id: building.id },
        update: {},
      });
      lotBuildingCount++;
    }
  }
  console.log(`[seed-prod] ${lotBuildingCount} lot-building associations upserted`);
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
