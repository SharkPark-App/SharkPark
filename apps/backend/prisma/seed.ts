/**
 * Prisma Seed Script
 *
 * Populates PostgreSQL with realistic test data for development:
 * - 1 school (CSULB)
 * - 28 parking lots with CSULB-accurate locations and capacities
 * - 5 user profiles with favorites
 * - 4 campus events with parking impacts
 * - Weather data
 * - 7 days of historical occupancy snapshots
 * - Sample occupancy events (ENTER/EXIT from geofencing)
 * - Device deduplication records
 *
 * Usage: pnpm db:seed
 */

import 'dotenv/config';
import { PrismaClient, UserType, CampusEventType, ImpactLevel, EventType, ConfidenceLevel } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { CSULB_SCHOOL, GEOFENCE_POLYGONS, generateGeofence, parkingLots } from './lot-data';
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
// Campus Events (mapped to CampusEventType enum)
// ────────────────────────────────────────────────────────────

const campusEvents = [
  {
    event_name: "Men's Basketball vs UC Irvine",
    event_type: CampusEventType.ATHLETIC,
    location: 'Walter Pyramid',
    start_time: new Date('2025-12-15T19:00:00Z'),
    end_time: new Date('2025-12-15T21:30:00Z'),
    expected_attendance: 4500,
    impacts: [
      { lot_id: 'G2', impact_level: ImpactLevel.HIGH, expected_increase_percent: 40 },
      { lot_id: 'G1', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 25 },
      { lot_id: 'G7', impact_level: ImpactLevel.LOW, expected_increase_percent: 10 },
      { lot_id: 'G4', impact_level: ImpactLevel.LOW, expected_increase_percent: 15 },
    ],
  },
  {
    event_name: 'Spring Commencement 2025',
    event_type: CampusEventType.ACADEMIC,
    location: 'Walter Pyramid',
    start_time: new Date('2025-05-17T09:00:00Z'),
    end_time: new Date('2025-05-17T18:00:00Z'),
    expected_attendance: 12000,
    impacts: [
      { lot_id: 'G2', impact_level: ImpactLevel.HIGH, expected_increase_percent: 50 },
      { lot_id: 'G1', impact_level: ImpactLevel.HIGH, expected_increase_percent: 50 },
      { lot_id: 'G7', impact_level: ImpactLevel.HIGH, expected_increase_percent: 35 },
      { lot_id: 'G4', impact_level: ImpactLevel.HIGH, expected_increase_percent: 40 },
      { lot_id: 'G3', impact_level: ImpactLevel.HIGH, expected_increase_percent: 30 },
      { lot_id: 'G9', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 20 },
    ],
  },
  {
    event_name: 'Winter Concert Series',
    event_type: CampusEventType.PERFORMANCE,
    location: 'University Theatre',
    start_time: new Date('2025-12-20T19:30:00Z'),
    end_time: new Date('2025-12-20T21:30:00Z'),
    expected_attendance: 800,
    impacts: [
      { lot_id: 'G9', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 15 },
      { lot_id: 'G4', impact_level: ImpactLevel.LOW, expected_increase_percent: 10 },
    ],
  },
  {
    event_name: 'Spring Career Fair',
    event_type: CampusEventType.ACADEMIC,
    location: 'USU Ballroom',
    start_time: new Date('2025-01-15T10:00:00Z'),
    end_time: new Date('2025-01-15T16:00:00Z'),
    expected_attendance: 2500,
    impacts: [
      { lot_id: 'G4', impact_level: ImpactLevel.HIGH, expected_increase_percent: 30 },
      { lot_id: 'G5', impact_level: ImpactLevel.HIGH, expected_increase_percent: 28 },
      { lot_id: 'G9', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 15 },
      { lot_id: 'G10', impact_level: ImpactLevel.MEDIUM, expected_increase_percent: 10 },
    ],
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
  await prisma.eventImpact.deleteMany();
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
        building_proximity: lot.building_proximity,
        center_lat: lot.center_lat,
        center_lng: lot.center_lng,
        geofence_polygon: GEOFENCE_POLYGONS[lot.lot_id] ?? generateGeofence(lot.center_lat, lot.center_lng, lot.geofence_radius),
        geofence_radius: lot.geofence_radius,
        permit_types: lot.permit_types,
        daily_permit_allowed: lot.daily_permit_allowed,
        daily_rate: lot.daily_rate,
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
        levels: lot.levels,
        penetration_rate: lot.penetration_rate,
        avg_turnover_minutes: lot.avg_turnover_minutes,
        confidence: lot.confidence,
      },
    });
    lotMap.set(lot.lot_id, created.id);
  }
  console.log(`[seed] Seeded ${parkingLots.length} parking lots\n`);

  // 4. Seed Users & Favorites
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

  // 5. Seed Campus Events & Impacts
  console.log('[seed] Seeding campus events...');
  let totalImpacts = 0;

  for (const event of campusEvents) {
    const created = await prisma.campusEvent.create({
      data: {
        school_id: school.id,
        event_name: event.event_name,
        event_type: event.event_type,
        location: event.location,
        start_time: event.start_time,
        end_time: event.end_time,
        expected_attendance: event.expected_attendance,
      },
    });

    for (const impact of event.impacts) {
      const lotDbId = lotMap.get(impact.lot_id);
      if (!lotDbId) continue;

      await prisma.eventImpact.create({
        data: {
          event_id: created.id,
          lot_id: lotDbId,
          impact_level: impact.impact_level,
          expected_increase_percent: impact.expected_increase_percent,
        },
      });
      totalImpacts++;
    }
  }
  console.log(`[seed] Seeded ${campusEvents.length} events with ${totalImpacts} impacts\n`);

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
            confidence: lot.confidence,
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
    events: await prisma.campusEvent.count(),
    impacts: await prisma.eventImpact.count(),
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
