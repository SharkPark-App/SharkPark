import { Injectable, Logger } from '@nestjs/common';
import { EventType } from '@prisma/client';

import { PrismaService } from '../database/database.module';

/**
 * 5-minute UTC bucket size, in milliseconds.
 *
 * Windows are aligned to wall-clock 5-min boundaries (00, 05, 10, …).
 * `floorTo5Min` truncates a Date down to the nearest boundary.
 */
const WINDOW_MS = 5 * 60 * 1000;

const GROUND_TRUTH_AGREEMENT_THRESHOLD = 0.7;
const GROUND_TRUTH_MIN_CONTRIBUTORS = 3;

export interface ConsensusComputeResult {
  /** Inclusive UTC start of the 5-min bucket. */
  windowStart: Date;
  /** Exclusive UTC end of the 5-min bucket (`windowStart + 5min`). */
  windowEnd: Date;
  /** Distinct device_hashes with at least one event in the window. */
  contributorCount: number;
  /** `1 - MAD/max(|median|,1)` clipped to [0,1]. 1.0 = perfect agreement. */
  agreementScore: number;
  /** Best-effort occupancy at windowEnd (DeviceState count for live, snapshot for backfill). */
  observedOccupancy: number;
  /** `observedOccupancy / capacity` rounded to 4 decimals. 0 if capacity ≤ 0. */
  observedRate: number;
  /** Gate: `agreementScore >= 0.7 AND contributorCount >= 3`. */
  isGroundTruth: boolean;
}

/**
 * ConsensusService
 *
 * Builds per-lot 5-minute "consensus" rows from contributor pings (the
 * `OccupancyEvent` log). Used for two purposes:
 *
 *   1. Live: invoked from the existing 15-minute snapshot job for the most-
 *      recently-completed 5-min window. See `processLiveTick`.
 *   2. Backfill: walked over the last 90 days by `scripts/backfill-consensus.ts`.
 *      See `backfillWindow`.
 *
 * The math (see the ConsensusObservation docstring in schema.prisma for the
 * data model context):
 *
 *   - `claims` = the running in-window net-occupancy delta after each event,
 *     starting from 0 (ENTER=+1, EXIT=-1). This series captures churn
 *     within the window, independent of the lot's absolute occupancy.
 *   - `agreement_score = clip(1 - MAD(claims)/max(|median(claims)|,1), 0, 1)`.
 *     A stable window (no churn) → MAD=0 → score=1. Rapid in/out → score→0.
 *   - `observed_occupancy` is the lot's actual occupancy at windowEnd:
 *       • Live → distinct DeviceState rows with last_event_type=ENTER.
 *       • Backfill → the OccupancySnapshot.occupancy nearest to windowEnd
 *         (within ±15 min), since DeviceState is mutable and cannot be
 *         time-traveled.
 *   - `is_ground_truth` requires `agreementScore >= 0.7` AND
 *     `contributorCount >= 3`.
 *
 * Idempotency: every write goes through the `(lot_id, window_start)` unique
 * index via `prisma.consensusObservation.upsert(...)`, so re-runs of the
 * backfill or accidental double-firings of the live tick are safe.
 */
@Injectable()
export class ConsensusService {
  private readonly logger = new Logger(ConsensusService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Live entry point. Called from snapshot.job after snapshots are written.
   * Computes consensus for the most recently *completed* 5-min window
   * (i.e., `[floorTo5Min(now) - 5min, floorTo5Min(now))`) for every lot.
   *
   * Errors per lot are logged and swallowed so a single bad lot cannot
   * block the rest of the snapshot tick.
   */
  async processLiveTick(now: Date): Promise<{ written: number; skipped: number }> {
    const windowEnd = floorTo5Min(now);
    const windowStart = new Date(windowEnd.getTime() - WINDOW_MS);

    const lots = await this.prisma.lot.findMany({ select: { id: true, capacity: true } });

    let written = 0;
    let skipped = 0;
    for (const lot of lots) {
      try {
        const result = await this.computeForWindow(lot.id, windowStart, windowEnd, lot.capacity, {
          mode: 'live',
        });
        if (result === null) {
          skipped += 1;
          continue;
        }
        await this.upsert(lot.id, result);
        written += 1;
      } catch (err) {
        skipped += 1;
        this.logger.warn(
          `consensus: live compute failed for lot=${lot.id} window=${windowStart.toISOString()} err=${(err as Error).message}`,
        );
      }
    }
    return { written, skipped };
  }

  /**
   * Backfill entry point. Computes + upserts a single `(lotId, windowStart)`
   * row using historical OccupancySnapshot for the baseline (not DeviceState,
   * which is mutable and not time-travelable).
   *
   * Returns `null` if the window had zero events (we don't write empty
   * rows — they'd just be noise in the consensus table).
   */
  async backfillWindow(
    lotId: string,
    windowStart: Date,
    capacity: number,
  ): Promise<ConsensusComputeResult | null> {
    const windowEnd = new Date(windowStart.getTime() + WINDOW_MS);
    const result = await this.computeForWindow(lotId, windowStart, windowEnd, capacity, {
      mode: 'backfill',
    });
    if (result === null) return null;
    await this.upsert(lotId, result);
    return result;
  }

  /**
   * Core compute. Returns null when the window had no events (so we can
   * skip the write rather than persist a contributor_count=0 row that
   * would muddy downstream analytics).
   */
  private async computeForWindow(
    lotId: string,
    windowStart: Date,
    windowEnd: Date,
    capacity: number,
    opts: { mode: 'live' | 'backfill' },
  ): Promise<ConsensusComputeResult | null> {
    const events = await this.prisma.occupancyEvent.findMany({
      where: {
        lot_id: lotId,
        timestamp: { gte: windowStart, lt: windowEnd },
      },
      select: { event_type: true, device_hash: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
    });

    if (events.length === 0) return null;

    const contributorCount = new Set(events.map((e) => e.device_hash)).size;

    // Build per-event running net-delta series. ENTER=+1, EXIT=-1.
    const claims: number[] = [];
    let running = 0;
    for (const e of events) {
      running += e.event_type === EventType.ENTER ? 1 : -1;
      claims.push(running);
    }

    const m = median(claims);
    const mad = meanAbsoluteDeviation(claims, m);
    const denom = Math.max(Math.abs(m), 1);
    const agreementScore = clip01(1 - mad / denom);

    const observedOccupancy =
      opts.mode === 'live'
        ? await this.queryLiveOccupancy(lotId)
        : await this.queryHistoricalOccupancy(lotId, windowEnd);

    const observedRate =
      capacity > 0 ? Math.round((observedOccupancy / capacity) * 10000) / 10000 : 0;

    const isGroundTruth =
      agreementScore >= GROUND_TRUTH_AGREEMENT_THRESHOLD &&
      contributorCount >= GROUND_TRUTH_MIN_CONTRIBUTORS;

    return {
      windowStart,
      windowEnd,
      contributorCount,
      agreementScore: Math.round(agreementScore * 10000) / 10000,
      observedOccupancy,
      observedRate,
      isGroundTruth,
    };
  }

  private async upsert(lotId: string, r: ConsensusComputeResult): Promise<void> {
    await this.prisma.consensusObservation.upsert({
      where: { lot_id_window_start: { lot_id: lotId, window_start: r.windowStart } },
      create: {
        lot_id: lotId,
        window_start: r.windowStart,
        window_end: r.windowEnd,
        contributor_count: r.contributorCount,
        agreement_score: r.agreementScore,
        observed_occupancy: r.observedOccupancy,
        observed_rate: r.observedRate,
        is_ground_truth: r.isGroundTruth,
      },
      update: {
        window_end: r.windowEnd,
        contributor_count: r.contributorCount,
        agreement_score: r.agreementScore,
        observed_occupancy: r.observedOccupancy,
        observed_rate: r.observedRate,
        is_ground_truth: r.isGroundTruth,
      },
    });
  }

  /** Distinct devices currently inside the lot per DeviceState. */
  private async queryLiveOccupancy(lotId: string): Promise<number> {
    return this.prisma.deviceState.count({
      where: { lot_id: lotId, last_event_type: EventType.ENTER },
    });
  }

  /**
   * Snapshot-derived occupancy for backfill. Uses the OccupancySnapshot
   * nearest to windowEnd within ±15 min; falls back to 0 if none. We don't
   * extrapolate further than ±15 min because snapshot cadence is 15 min and
   * occupancy can change materially over longer gaps.
   */
  private async queryHistoricalOccupancy(lotId: string, windowEnd: Date): Promise<number> {
    const fifteenMinMs = 15 * 60 * 1000;
    const min = new Date(windowEnd.getTime() - fifteenMinMs);
    const max = new Date(windowEnd.getTime() + fifteenMinMs);

    const [before, after] = await Promise.all([
      this.prisma.occupancySnapshot.findFirst({
        where: { lot_id: lotId, timestamp: { gte: min, lte: windowEnd } },
        orderBy: { timestamp: 'desc' },
        select: { occupancy: true, timestamp: true },
      }),
      this.prisma.occupancySnapshot.findFirst({
        where: { lot_id: lotId, timestamp: { gt: windowEnd, lte: max } },
        orderBy: { timestamp: 'asc' },
        select: { occupancy: true, timestamp: true },
      }),
    ]);

    if (!before && !after) return 0;
    if (before && !after) return before.occupancy;
    if (!before && after) return after.occupancy;
    // Pick whichever is closer in time.
    const beforeDelta = Math.abs(windowEnd.getTime() - before!.timestamp.getTime());
    const afterDelta = Math.abs(after!.timestamp.getTime() - windowEnd.getTime());
    return beforeDelta <= afterDelta ? before!.occupancy : after!.occupancy;
  }
}

// ─── Pure helpers (exported for unit testing) ────────────────────────────

export function floorTo5Min(date: Date): Date {
  const ms = date.getTime();
  return new Date(ms - (ms % WINDOW_MS));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function meanAbsoluteDeviation(values: readonly number[], center: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += Math.abs(v - center);
  return sum / values.length;
}

export function clip01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
