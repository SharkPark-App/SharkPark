/**
 * Prisma Seed Script
 *
 * Populates PostgreSQL with realistic test data for development:
 * - 1 school (CSULB)
 * - 28 parking lots with CSULB-accurate locations and capacities
 * - 5 user profiles with favorites
 * - 4 campus events for display in the mobile app
 * - Weather data
 * - 7 days of historical occupancy snapshots
 * - Sample occupancy events (ENTER/EXIT from geofencing)
 * - Device deduplication records
 *
 * Usage: pnpm db:seed
 */

import 'dotenv/config';
import { PrismaClient, UserType, EventType, ConfidenceLevel } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { CSULB_SCHOOL, CSULB_BUILDINGS, parkingLots } from './lot-data';
import { LOT_GEOFENCES } from './lot-geofences.generated';
import { LOT_ADVISORIES } from './lot-advisories.generated';
import { BUILDING_FOOTPRINTS } from './building-footprints.generated';
import { deriveLotBuildings } from '../src/lots/derive-lot-buildings';
import { getSemester, getWeekOfSemester } from '../src/lots/academic-calendar';

// Prisma v7: "client" engine requires a driver adapter for direct DB connections
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ────────────────────────────────────────────────────────────
// Helpers

// ────────────────────────────────────────────────────────────
// Test Users
// ────────────────────────────────────────────────────────────

const testUsers = [
  {
    email: 'charles.milton@csulb.edu', user_type: UserType.STUDENT,
    first_name: 'Charles', last_name: 'Milton', phone: '+15625551234',
    created_at: new Date('2025-09-01'),
    notification_preferences: { favorites_filling: true, favorites_clearing: true, surge_alerts: true, event_alerts: true },
    favorites: ['G1', 'G7', 'G4'],
  },
  {
    email: 'lawrence.degoma@csulb.edu', user_type: UserType.STUDENT,
    first_name: 'Lawrence', last_name: 'Degoma', phone: '+15625551235',
    created_at: new Date('2025-09-01'),
    notification_preferences: { favorites_filling: true, favorites_clearing: false, surge_alerts: true, event_alerts: true },
    favorites: ['G2', 'G9'],
  },
  {
    email: 'ly.nguyen@csulb.edu', user_type: UserType.EMPLOYEE,
    first_name: 'Ly', last_name: 'Nguyen', phone: '+15625551236',
    created_at: new Date('2025-09-05'),
    notification_preferences: { favorites_filling: true, favorites_clearing: true, surge_alerts: false, event_alerts: true },
    favorites: ['E1', 'E3', 'G4'],
  },
  {
    email: 'zachary.padilla@csulb.edu', user_type: UserType.STUDENT,
    first_name: 'Zachary', last_name: 'Padilla', phone: '+15625551237',
    created_at: new Date('2025-09-02'),
    notification_preferences: { favorites_filling: true, favorites_clearing: true, surge_alerts: true, event_alerts: false },
    favorites: ['G7', 'G8', 'E2'],
  },
  {
    email: 'charles.m2@csulb.edu', user_type: UserType.EMPLOYEE,
    first_name: 'Charles', last_name: 'Milton', phone: '+15625551238',
    created_at: new Date('2025-09-10'),
    notification_preferences: { favorites_filling: false, favorites_clearing: false, surge_alerts: true, event_alerts: true },
    favorites: ['E3', 'E5', 'G14'],
  },
];

// ────────────────────────────────────────────────────────────
// Campus Events — seed data for local development.
// In production these are populated by the fetch-events cron (CampusLabs scraper).
// Dates are relative to now so the events always fall within the 7-day query window.
// ────────────────────────────────────────────────────────────

function daysFromNow(days: number, hour = 19): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const campusEvents = [
  {
    external_id: 'seed-basketball-home',
    event_name: "Men's Basketball — Home Game",
    description: 'Come cheer on the 49ers as they take on our rivals in an exciting home game at the Walter Pyramid! Free entry for students with valid ID. Go Beach!',
    location: 'Walter Pyramid',
    start_time: daysFromNow(0, 19),
    end_time: daysFromNow(0, 21),
  },
  {
    external_id: 'seed-spring-commencement',
    event_name: 'Spring Commencement',
    location: 'Walter Pyramid',
    start_time: daysFromNow(2, 9),
    end_time: daysFromNow(2, 18),
  },
  {
    external_id: 'seed-career-fair',
    event_name: 'Spring Career Fair',
    description: 'Connect with potential employers and explore career opportunities at our annual Spring Career Fair!',
    location: 'USU Ballroom',
    start_time: daysFromNow(4, 10),
    end_time: daysFromNow(4, 16),
  },
  {
    external_id: 'seed-concert',
    event_name: 'Spring Concert Series',
    location: 'University Theatre',
    start_time: daysFromNow(6, 19),
    end_time: daysFromNow(6, 21),
  },
];

// ────────────────────────────────────────────────────────────
// Seed Functions
// ────────────────────────────────────────────────────────────

async function main() {
  console.log('[seed] SharkPark PostgreSQL Database Seeding\n');

  // 1. Clear existing data (cascade)
  console.log('[seed] Clearing existing data...');
  await prisma.deviceState.deleteMany();
  await prisma.occupancyEvent.deleteMany();
  await prisma.occupancySnapshot.deleteMany();
  await prisma.userFavorite.deleteMany();
  await prisma.predictionShortTerm.deleteMany();
  await prisma.predictionLongTerm.deleteMany();
  await prisma.campusEvent.deleteMany();
  await prisma.weather.deleteMany();
  await prisma.user.deleteMany();
  await prisma.lot.deleteMany();
  await prisma.school.deleteMany();
  console.log('[seed] Cleared.\n');

  // 2. Create School
  console.log('[seed] Creating school...');
  const school = await prisma.school.create({
    data: {
      school_name: CSULB_SCHOOL.school_name,
      short_name: CSULB_SCHOOL.short_name,
      timezone: CSULB_SCHOOL.timezone,
    },
  });
  console.log(`[seed] Created school: ${school.short_name} (${school.id})\n`);

  // 3. Seed Lots
  console.log('[seed] Seeding parking lots...');
  const lotMap = new Map<string, string>(); // lot_id -> prisma id

  for (const lot of parkingLots) {
    const geofence = LOT_GEOFENCES[lot.lot_id];
    if (!geofence) {
      throw new Error(
        `[seed] No concept3d geofence for lot_id=${lot.lot_id}. ` +
          `Re-run prisma/scripts/extract-lot-polygons.ts after updating lookup rules.`,
      );
    }
    const created = await prisma.lot.create({
      data: {
        school_id: school.id,
        lot_id: lot.lot_id,
        lot_name: lot.lot_name,
        display_name: lot.display_name,
        lot_number: lot.lot_number,
        lot_type: lot.lot_type,
        capacity: lot.capacity,
        current_occupancy: lot.current_occupancy,
        location_description: lot.location_description,
        center_lat: lot.center_lat,
        center_lng: lot.center_lng,
        geofence_polygon: geofence.polygon,
        geofence_radius: geofence.radius_m,
        permit_types: lot.permit_types,
        daily_permit_allowed: lot.daily_permit_allowed,
        daily_rate: lot.daily_rate,
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
        levels: lot.levels,
        metadata_confidence: lot.metadata_confidence,
      },
    });
    lotMap.set(lot.lot_id, created.id);
  }
  console.log(`[seed] Seeded ${parkingLots.length} parking lots\n`);

  // 4. Seed Buildings
  console.log('[seed] Seeding buildings...');
  const buildingMap = new Map<string, { id: string; alternate_names: string[] }>(); // name -> { id, alternate_names }

  // Pre-merge footprint polygons so derive-lot-buildings can use point-to-edge
  // distance (centroid haversine fallback when polygon is missing).
  const buildingsWithFootprints = CSULB_BUILDINGS.map((b) => ({
    ...b,
    polygon: BUILDING_FOOTPRINTS[b.name]?.polygon ?? null,
  }));

  for (const b of buildingsWithFootprints) {
    const created = await prisma.building.create({
      data: {
        school_id: school.id,
        name: b.name,
        alternate_names: b.alternate_names,
        center_lat: b.lat,
        center_lng: b.lng,
        footprint_polygon: b.polygon ?? undefined,
        category: b.category,
      },
    });
    buildingMap.set(b.name, { id: created.id, alternate_names: b.alternate_names });
  }
  console.log(`[seed] Seeded ${CSULB_BUILDINGS.length} buildings\n`);

  // 5. Seed Lot-Building associations
  console.log('[seed] Seeding lot-building associations...');
  let lotBuildingCount = 0;

  for (const lot of parkingLots) {
    const lotDbId = lotMap.get(lot.lot_id);
    if (!lotDbId) continue;

    const nearbyNames = deriveLotBuildings(lot, buildingsWithFootprints);
    for (const proximity of nearbyNames) {
      const building = buildingMap.get(proximity); // exact name match — no duplicates possible
      if (!building) continue;
      await prisma.lotBuilding.create({
        data: { lot_id: lotDbId, building_id: building.id },
      });
      lotBuildingCount++;
    }
  }
  console.log(`[seed] Seeded ${lotBuildingCount} lot-building associations\n`);

  // 6. Seed Lot Advisories (concept3d construction/closure overlay)
  console.log('[seed] Seeding lot advisories...');
  let advisoryCount = 0;
  for (const adv of LOT_ADVISORIES) {
    const lotDbId = lotMap.get(adv.lot_id);
    if (!lotDbId) continue;
    await prisma.lotAdvisory.create({
      data: {
        school_id: school.id,
        lot_id: lotDbId,
        title: adv.title,
        description: adv.description,
        severity: adv.severity,
        source: 'CONCEPT3D',
        source_cat_id: adv.source_cat_id,
        source_marker_id: adv.source_marker_id,
        match_reason: adv.match_reason,
        polygon: adv.polygon as unknown as object,
        is_active: true,
      },
    });
    advisoryCount++;
  }
  console.log(`[seed] Seeded ${advisoryCount} lot advisories\n`);

  // 7. Seed Users & Favorites
  console.log('[seed] Seeding users...');
  let totalFavorites = 0;

  for (const user of testUsers) {
    const created = await prisma.user.create({
      data: {
        school_id: school.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        user_type: user.user_type,
        phone: user.phone,
        notification_preferences: user.notification_preferences,
        created_at: user.created_at,
        last_login: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      },
    });

    for (const favLotId of user.favorites) {
      const lotDbId = lotMap.get(favLotId);
      if (!lotDbId) continue;

      await prisma.userFavorite.create({
        data: {
          user_id: created.id,
          lot_id: lotDbId,
          added_at: new Date(user.created_at.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000),
        },
      });
      totalFavorites++;
    }
  }
  console.log(`[seed] Seeded ${testUsers.length} users with ${totalFavorites} favorites\n`);

  // 8. Seed Campus Events
  console.log('[seed] Seeding campus events...');

  for (const event of campusEvents) {
    const loc = event.location.toLowerCase();
    let buildingId: string | null = null;
    for (const [, b] of buildingMap) {
      if (b.alternate_names.some(alt => loc.includes(alt.toLowerCase()))) {
        buildingId = b.id;
        break;
      }
    }

    await prisma.campusEvent.create({
      data: {
        school_id: school.id,
        external_id: event.external_id,
        event_name: event.event_name,
        description: event.description,
        location: event.location,
        start_time: event.start_time,
        end_time: event.end_time,
        building_id: buildingId,
      },
    });
  }
  console.log(`[seed] Seeded ${campusEvents.length} events\n`);

  // 6. Seed Weather
  console.log('[seed] Seeding weather data...');
  await prisma.weather.create({
    data: {
      school_id: school.id,
      timestamp: new Date(),
      temperature_f: 68,
      feels_like_f: 66,
      humidity_percent: 55,
      wind_speed_mph: 8,
      conditions: 'Partly Cloudy',
      precipitation_probability: 0.10,
      is_raining: false,
    },
  });
  console.log('[seed] Seeded weather data\n');

  // 7. Seed Historical Occupancy Snapshots (7 days, every 15 min during operating hours)
  //
  // We populate every column the runtime snapshot cron writes. Treat synthetic
  // `occupancy` values as already-scaled estimates (i.e. total cars seen by
  // sensors, not raw device counts), so estimated_occupancy mirrors occupancy
  // and penetration_rate_used = 1.0. That keeps ML notebooks and the mobile
  // history view honest against seed data while staying clearly synthetic.
  console.log('[seed] Seeding historical occupancy snapshots...');
  const sampleLotIds = ['G1', 'G2', 'G4', 'G7', 'G9'];
  const now = new Date();
  // Use the seeded weather row as the snapshot's weather context.
  const seedWeather = await prisma.weather.findFirst({
    where: { school_id: school.id },
    orderBy: { timestamp: 'desc' },
  });
  const snapshotRows: {
    lot_id: string; timestamp: Date; occupancy: number; available: number;
    occupancy_rate: number; confidence: ConfidenceLevel; is_campus_open: boolean;
    estimated_occupancy: number; penetration_rate_used: number;
    reliability_score: number; is_cold_start: boolean;
    semester: string; academic_period: string; week_of_semester: number;
    weather_id: string | null;
  }[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);

    for (let hour = 6; hour < 22; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const timestamp = new Date(date);
        timestamp.setHours(hour, minute, 0, 0);

        // Academic-calendar features are date-derived and identical for every
        // lot at the same timestamp — compute once per tick.
        const semester = getSemester(timestamp);
        const [weekOfSemester, periodType] = getWeekOfSemester(timestamp);

        for (const lotId of sampleLotIds) {
          const lot = parkingLots.find(l => l.lot_id === lotId);
          if (!lot) continue;
          const lotDbId = lotMap.get(lotId);
          if (!lotDbId) continue;

          const isPeak = (hour >= 8 && hour <= 10) || (hour >= 12 && hour <= 14);
          const baseRate = isPeak ? 0.85 : 0.60;
          const variance = Math.random() * 0.15;
          const occRate = Math.min(0.98, Math.max(0.30, baseRate + variance));
          const occupancy = Math.floor(lot.capacity * occRate);
          const available = lot.capacity - occupancy;

          snapshotRows.push({
            lot_id: lotDbId,
            timestamp,
            occupancy,
            available,
            occupancy_rate: Math.round(occRate * 1000) / 1000,
            confidence: lot.metadata_confidence,
            is_campus_open: true,
            // Synthetic data is already "total cars" — no scaling applied.
            estimated_occupancy: occupancy,
            penetration_rate_used: 1.0,
            // Plausible reliability for established seed lots.
            reliability_score: 0.8,
            is_cold_start: false,
            semester,
            academic_period: periodType,
            week_of_semester: weekOfSemester,
            weather_id: seedWeather?.id ?? null,
          });
        }
      }
    }
  }

  // Batch insert in chunks of 500
  for (let i = 0; i < snapshotRows.length; i += 500) {
    await prisma.occupancySnapshot.createMany({ data: snapshotRows.slice(i, i + 500) });
  }
  console.log(`[seed] Seeded ${snapshotRows.length} historical occupancy snapshots\n`);

  // 8. Seed Occupancy Events (last 2 hours, all lots)
  // Generate ~1,500 unique device hashes so countCampusDevices returns a
  // realistic number and the scaling cap doesn't bottleneck at 2×.
  console.log('[seed] Generating unique device hashes...');
  const TOTAL_CAMPUS_DEVICES = 1500;
  const allDeviceHashes: string[] = [];
  for (let i = 0; i < TOTAL_CAMPUS_DEVICES; i++) {
    // Deterministic hex hashes: pad index and repeat to 64 chars
    const hex = i.toString(16).padStart(4, '0');
    allDeviceHashes.push(hex.repeat(16));
  }

  console.log('[seed] Seeding occupancy events...');
  const eventRows: {
    lot_id: string; event_type: EventType; device_hash: string; timestamp: Date;
  }[] = [];
  const deviceStateRows: {
    device_hash: string; lot_id: string; last_event_type: EventType; updated_at: Date;
  }[] = [];

  // Distribute devices across lots proportional to each lot's current_occupancy.
  // Each lot's current_occupancy is already the raw device count, so we use that
  // as the number of unique devices that should have recent events in that lot.
  let hashCursor = 0;
  for (const lot of parkingLots) {
    const lotDbId = lotMap.get(lot.lot_id);
    if (!lotDbId) continue;

    const numDevices = lot.current_occupancy;
    for (let d = 0; d < numDevices && hashCursor < allDeviceHashes.length; d++) {
      const deviceHash = allDeviceHashes[hashCursor++];

      // Create an ENTER event within the last 90 minutes (inside the 2-hour window)
      const minutesAgo = Math.floor(Math.random() * 90);
      const eventTimestamp = new Date(now.getTime() - minutesAgo * 60 * 1000);

      eventRows.push({
        lot_id: lotDbId,
        event_type: EventType.ENTER,
        device_hash: deviceHash,
        timestamp: eventTimestamp,
      });

      // Track device state for deduplication
      deviceStateRows.push({
        device_hash: deviceHash,
        lot_id: lotDbId,
        last_event_type: EventType.ENTER,
        updated_at: eventTimestamp,
      });
    }
  }

  // Batch insert events in chunks of 500
  for (let i = 0; i < eventRows.length; i += 500) {
    await prisma.occupancyEvent.createMany({ data: eventRows.slice(i, i + 500) });
  }
  console.log(`[seed] Seeded ${eventRows.length} occupancy events (${hashCursor} unique devices)\n`);

  // 9. Seed Device State (deduplication records)
  console.log('[seed] Seeding device state records...');
  for (let i = 0; i < deviceStateRows.length; i += 500) {
    await prisma.deviceState.createMany({ data: deviceStateRows.slice(i, i + 500) });
  }
  console.log(`[seed] Seeded ${deviceStateRows.length} device state records\n`);

  // 10. Verify
  const counts = {
    schools: await prisma.school.count(),
    lots: await prisma.lot.count(),
    users: await prisma.user.count(),
    favorites: await prisma.userFavorite.count(),
    campusEvents: await prisma.campusEvent.count(),
    weather: await prisma.weather.count(),
    snapshots: await prisma.occupancySnapshot.count(),
    occEvents: await prisma.occupancyEvent.count(),
    deviceStates: await prisma.deviceState.count(),
  };

  console.log('[seed] Database Summary:');
  Object.entries(counts).forEach(([key, count]) => {
    console.log(`[seed]   ${key}: ${count}`);
  });

  console.log('\n[seed] Seeding complete!');
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
