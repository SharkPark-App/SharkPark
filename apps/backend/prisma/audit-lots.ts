/**
 * audit:lots — drift report between lot-data.ts (canonical seed) and the
 * live database. Run with `pnpm --filter backend audit:lots`.
 *
 * Output is a per-lot, per-field comparison highlighting any divergence so an
 * operator can decide whether to re-seed or update the seed file.
 *
 * Read-only: this script never writes to the database.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';
import { parkingLots, LotSeed } from './lot-data';

// Fields whose drift we want to surface. We deliberately omit volatile
// columns like `current_occupancy` (it's a live counter) and any fields not
// expressed in lot-data.ts.
const COMPARED_FIELDS = [
  'lot_name',
  'display_name',
  'lot_number',
  'lot_type',
  'capacity',
  'location_description',
  'permit_types',
  'daily_permit_allowed',
  'daily_rate',
  'ev_charging_stations',
  'motorcycle_spaces',
  'accessible_spaces',
  'short_term_parking_spaces',
  'low_emission_spaces',
  'pay_stations',
  'has_lighting',
  'has_cameras',
  'has_emergency_phone',
  'is_covered',
  'is_paved',
  'is_structure',
  'has_solar_canopy',
  'levels',
  'metadata_confidence',
] as const satisfies ReadonlyArray<keyof LotSeed>;

type ComparedField = (typeof COMPARED_FIELDS)[number];

function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return [...value].sort();
  // Prisma Decimal → number for comparable equality
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof (value as { toNumber: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return value;
}

function equal(a: unknown, b: unknown): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  // Optional booleans (e.g. is_structure) are `undefined` in seed but resolve
  // to `false` in DB via Prisma defaults. Treat as equal.
  if ((na === null && nb === false) || (na === false && nb === null)) return true;
  if (Array.isArray(na) && Array.isArray(nb)) {
    return na.length === nb.length && na.every((v, i) => v === nb[i]);
  }
  return na === nb;
}

async function main(): Promise<void> {
  const rawConnectionString = process.env.DATABASE_URL;
  if (!rawConnectionString) {
    console.error('[audit:lots] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }
  // Strip libpq-only params node-postgres doesn't understand.
  const url = new URL(rawConnectionString);
  if (url.searchParams.get('sslrootcert') === 'system') {
    url.searchParams.delete('sslrootcert');
  }
  const pool = new pg.Pool({ connectionString: url.toString() });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    const dbLots = await prisma.lot.findMany();
    const dbByLotId = new Map(dbLots.map((l: { lot_id: string }) => [l.lot_id, l]));
    const seedByLotId = new Map(parkingLots.map((l) => [l.lot_id, l]));

    const missingInDb: string[] = [];
    const missingInSeed: string[] = [];
    const drifts: Array<{ lot_id: string; field: ComparedField; seed: unknown; db: unknown }> = [];

    for (const seed of parkingLots) {
      const db = dbByLotId.get(seed.lot_id);
      if (!db) {
        missingInDb.push(seed.lot_id);
        continue;
      }
      for (const field of COMPARED_FIELDS) {
        const seedValue = seed[field];
        const dbValue = (db as Record<string, unknown>)[field];
        if (!equal(seedValue, dbValue)) {
          drifts.push({ lot_id: seed.lot_id, field, seed: seedValue, db: dbValue });
        }
      }
    }

    for (const db of dbLots) {
      if (!seedByLotId.has(db.lot_id)) missingInSeed.push(db.lot_id);
    }

    let exitCode = 0;

    if (missingInDb.length > 0) {
      exitCode = 1;
      console.log('\nLots present in seed but missing from DB:');
      for (const id of missingInDb) console.log(`  - ${id}`);
    }

    if (missingInSeed.length > 0) {
      exitCode = 1;
      console.log('\nLots present in DB but missing from seed:');
      for (const id of missingInSeed) console.log(`  - ${id}`);
    }

    if (drifts.length > 0) {
      exitCode = 1;
      console.log('\nField drift (seed != db):');
      const byLot = new Map<string, typeof drifts>();
      for (const d of drifts) {
        const arr = byLot.get(d.lot_id) ?? [];
        arr.push(d);
        byLot.set(d.lot_id, arr);
      }
      for (const [lotId, lotDrifts] of byLot) {
        console.log(`\n  ${lotId}:`);
        for (const d of lotDrifts) {
          console.log(`    ${d.field}:`);
          console.log(`      seed: ${JSON.stringify(d.seed)}`);
          console.log(`      db:   ${JSON.stringify(d.db)}`);
        }
      }
    }

    if (exitCode === 0) {
      console.log(`\n✔ No drift. ${parkingLots.length} lots in seed match ${dbLots.length} lots in DB across ${COMPARED_FIELDS.length} fields.`);
    } else {
      console.log(
        `\n✗ Drift detected: ${missingInDb.length} missing in DB, ${missingInSeed.length} missing in seed, ${drifts.length} field mismatch${drifts.length === 1 ? '' : 'es'}.`,
      );
    }

    process.exit(exitCode);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
