/**
 * B3: Consensus backfill.
 *
 * Densely walks every 5-minute UTC bucket over a configurable window
 * (default: last 90 days) and upserts a `consensus_observations` row per
 * lot/window via `ConsensusService.backfillWindow`. Idempotent — safe to
 * re-run.
 *
 * Usage (from `apps/backend`):
 *   pnpm exec ts-node --project tsconfig.scripts.json --compiler-options \
 *     '{"module":"CommonJS"}' src/scripts/backfill-consensus.ts
 *
 * Optional env vars:
 *   BACKFILL_DAYS=90               How far back to walk (integer days, 1..365).
 *   BACKFILL_LOT_ID=<lots.id>      Restrict to a single lot (default: all).
 *   BACKFILL_BATCH_LOG_EVERY=500   Log progress every N processed windows.
 *
 * Why a standalone script (not a cron job): backfill is a one-shot
 * operation operators run after deploying B1/B2, and re-run only on
 * schema or math changes. It would dwarf the 15-minute cron tick budget
 * if scheduled. The script keeps the consensus table dense for ML
 * training without coupling to the live tick.
 */
import 'dotenv/config';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { DatabaseModule, PrismaService } from '../database/database.module';
import {
  appConfig,
  authConfig,
  dbConfig,
  privacyConfig,
  weatherConfig,
  notificationsConfig,
  validateConfig,
} from '../config/configuration';
import { ConsensusService } from '../reliability/consensus.service';

const WINDOW_MS = 5 * 60 * 1000;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        authConfig,
        dbConfig,
        privacyConfig,
        weatherConfig,
        notificationsConfig,
      ],
      validate: validateConfig,
    }),
    DatabaseModule,
  ],
  providers: [ConsensusService],
})
class BackfillModule {}

function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Expected integer in [${min},${max}] for ${name}, got "${raw}"`);
  }
  return n;
}

function floorTo5Min(date: Date): Date {
  const ms = date.getTime();
  return new Date(ms - (ms % WINDOW_MS));
}

async function main(): Promise<void> {
  const days = parseIntEnv('BACKFILL_DAYS', 90, 1, 365);
  const lotIdFilter = process.env.BACKFILL_LOT_ID?.trim() || null;
  const logEvery = parseIntEnv('BACKFILL_BATCH_LOG_EVERY', 500, 1, 100_000);

  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();

  const prisma = app.get(PrismaService);
  const consensus = app.get(ConsensusService);

  try {
    const lots = await prisma.lot.findMany({
      where: lotIdFilter ? { id: lotIdFilter } : undefined,
      select: { id: true, lot_id: true, capacity: true },
    });
    if (lots.length === 0) {
      console.warn(
        `[backfill-consensus] no lots matched ${lotIdFilter ? `id=${lotIdFilter}` : '(any)'}; nothing to do`,
      );
      return;
    }

    const now = new Date();
    const end = floorTo5Min(now);
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const totalWindows = (end.getTime() - start.getTime()) / WINDOW_MS;
    const totalOps = totalWindows * lots.length;

    console.log(
      `[backfill-consensus] start: ${start.toISOString()} → ${end.toISOString()} ` +
        `(${days}d, ${lots.length} lots, ~${Math.round(totalOps).toLocaleString()} window ops)`,
    );

    let processed = 0;
    let written = 0;
    let empty = 0;
    let failed = 0;
    const t0 = Date.now();

    for (let ws = start.getTime(); ws < end.getTime(); ws += WINDOW_MS) {
      const windowStart = new Date(ws);
      for (const lot of lots) {
        try {
          const r = await consensus.backfillWindow(lot.id, windowStart, lot.capacity);
          if (r === null) empty += 1;
          else written += 1;
        } catch (err) {
          failed += 1;
          console.warn(
            `[backfill-consensus] failed lot=${lot.lot_id} window=${windowStart.toISOString()}: ` +
              `${(err as Error).message}`,
          );
        }
        processed += 1;
        if (processed % logEvery === 0) {
          const elapsedSec = (Date.now() - t0) / 1000;
          const rate = processed / Math.max(elapsedSec, 0.001);
          const remaining = Math.round(totalOps) - processed;
          const etaSec = remaining / Math.max(rate, 0.001);
          console.log(
            `[backfill-consensus] processed=${processed.toLocaleString()} ` +
              `written=${written.toLocaleString()} empty=${empty.toLocaleString()} ` +
              `failed=${failed.toLocaleString()} rate=${rate.toFixed(1)}/s ` +
              `eta=${(etaSec / 60).toFixed(1)}m`,
          );
        }
      }
    }

    const elapsedSec = (Date.now() - t0) / 1000;
    console.log(
      `[backfill-consensus] DONE in ${elapsedSec.toFixed(1)}s — ` +
        `processed=${processed.toLocaleString()} written=${written.toLocaleString()} ` +
        `empty=${empty.toLocaleString()} failed=${failed.toLocaleString()}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[backfill-consensus] FATAL', err);
  process.exit(1);
});
