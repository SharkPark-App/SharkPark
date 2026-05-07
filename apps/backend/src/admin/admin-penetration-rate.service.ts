import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/database.module';

/**
 * Read-only operator view over `penetration_rate_estimates` for a single lot.
 *
 * Backs `GET /admin/penetration-rate/:lotId` — returns the learned EWMA value
 * for every (dow_bucket × hour_bucket) cell we currently have data for, plus
 * the gating thresholds the runtime uses to decide whether to blend that
 * value into the rule-based estimate (see `PenetrationEstimationService`).
 *
 * Operators use this to:
 *   1. Verify the C2 nightly recompute is producing values for the expected
 *      buckets after a deploy or DB restore.
 *   2. Spot-check that learned rates are converging to plausible values
 *      (~0.05–0.50 typical) before flipping `PENETRATION_RATE_LEARNING_ENABLED`.
 *   3. Diagnose lots that are stuck on the rule path because their cells are
 *      stale or undersampled.
 *
 * `lotId` accepts either the cuid PK (`Lot.id`) or the human-readable
 * `lot_id` code (e.g. "G1") to match how operators read fly logs.
 */

// MUST stay in sync with the same constants in penetration-estimation.service.ts.
// Re-declared here (rather than imported) because they're surface-level
// contract values that operators need to see in the admin response — coupling
// the admin payload to the service's private constants would hide the gating
// thresholds the operator is actually trying to verify.
const LEARNED_BLEND_WEIGHT = 0.7;
const MIN_LEARNED_SAMPLE_COUNT = 30;
const LEARNED_FRESHNESS_DAYS = 14;
const LEARNED_FRESHNESS_MS = LEARNED_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;

const DOW_BUCKET_LABELS: Record<number, string> = {
  0: 'weekday',
  1: 'saturday',
  2: 'sunday',
};

export interface PenetrationRateBucketDto {
  dowBucket: number;
  dowLabel: string;
  hourBucket: number;
  ewmaValue: number;
  ewmaVariance: number;
  sampleCount: number;
  lastUpdated: string;
  ageDays: number;
  /** True iff `lastUpdated` is within `LEARNED_FRESHNESS_DAYS`. */
  isFresh: boolean;
  /** True iff `sampleCount >= MIN_LEARNED_SAMPLE_COUNT`. */
  isWellSampled: boolean;
  /**
   * True iff the runtime would blend this cell when the feature flag is on.
   * Equivalent to `isFresh && isWellSampled`.
   */
  willBlend: boolean;
}

export interface AdminPenetrationRateResponse {
  lotId: string;
  lotCode: string;
  /** Snapshot of `PENETRATION_RATE_LEARNING_ENABLED` at request time. */
  flagEnabled: boolean;
  thresholds: {
    blendWeight: number;
    minSampleCount: number;
    freshnessDays: number;
  };
  totalBuckets: number;
  /** Count of cells where `willBlend === true`. */
  blendableBuckets: number;
  buckets: PenetrationRateBucketDto[];
}

@Injectable()
export class AdminPenetrationRateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compact summary of every lot that has at least one row in
   * `penetration_rate_estimates`. Powers the dashboard EWMA grid;
   * the per-lot detail view is `getForLot(lotId)`.
   *
   * One round trip via `groupBy` (no per-lot N+1).
   */
  async listAllLots(): Promise<
    Array<{
      lotId: string;
      lotCode: string;
      totalBuckets: number;
      blendableBuckets: number;
      lastUpdatedAt: string | null;
      meanEwma: number | null;
    }>
  > {
    const now = Date.now();
    type Row = {
      lot_id: string;
      lot_code: string;
      total_buckets: bigint;
      blendable_buckets: bigint;
      mean_ewma: number | null;
      last_updated: Date | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        l.id AS lot_id,
        l.lot_id AS lot_code,
        COUNT(*)::bigint AS total_buckets,
        COUNT(*) FILTER (
          WHERE p.sample_count >= ${MIN_LEARNED_SAMPLE_COUNT}
            AND p.last_updated >= ${new Date(now - LEARNED_FRESHNESS_MS)}
        )::bigint AS blendable_buckets,
        AVG(p.ewma_value)::float AS mean_ewma,
        MAX(p.last_updated) AS last_updated
      FROM penetration_rate_estimates p
      JOIN lots l ON l.id = p.lot_id
      GROUP BY l.id, l.lot_id
      ORDER BY l.lot_id ASC
    `;
    return rows.map((r) => ({
      lotId: r.lot_id,
      lotCode: r.lot_code,
      totalBuckets: Number(r.total_buckets),
      blendableBuckets: Number(r.blendable_buckets),
      meanEwma: r.mean_ewma,
      lastUpdatedAt: r.last_updated?.toISOString() ?? null,
    }));
  }

  async getForLot(lotIdParam: string): Promise<AdminPenetrationRateResponse> {
    if (!lotIdParam || lotIdParam.length === 0) {
      throw new BadRequestException('lotId path param is required');
    }

    const lot = await this.resolveLot(lotIdParam);
    if (lot === null) {
      throw new NotFoundException(`No lot found matching "${lotIdParam}"`);
    }

    const rows = await this.prisma.penetrationRateEstimate.findMany({
      where: { lot_id: lot.id },
      orderBy: [{ dow_bucket: 'asc' }, { hour_bucket: 'asc' }],
    });

    const now = Date.now();
    const buckets: PenetrationRateBucketDto[] = rows.map((r) => {
      const ageMs = now - r.last_updated.getTime();
      const isFresh = ageMs <= LEARNED_FRESHNESS_MS;
      const isWellSampled = r.sample_count >= MIN_LEARNED_SAMPLE_COUNT;
      return {
        dowBucket: r.dow_bucket,
        dowLabel: DOW_BUCKET_LABELS[r.dow_bucket] ?? `unknown(${r.dow_bucket})`,
        hourBucket: r.hour_bucket,
        ewmaValue: round4(r.ewma_value),
        ewmaVariance: round6(r.ewma_variance),
        sampleCount: r.sample_count,
        lastUpdated: r.last_updated.toISOString(),
        ageDays: Math.round((ageMs / (24 * 60 * 60 * 1000)) * 10) / 10,
        isFresh,
        isWellSampled,
        willBlend: isFresh && isWellSampled,
      };
    });

    return {
      lotId: lot.id,
      lotCode: lot.lot_id,
      flagEnabled: process.env.PENETRATION_RATE_LEARNING_ENABLED === 'true',
      thresholds: {
        blendWeight: LEARNED_BLEND_WEIGHT,
        minSampleCount: MIN_LEARNED_SAMPLE_COUNT,
        freshnessDays: LEARNED_FRESHNESS_DAYS,
      },
      totalBuckets: buckets.length,
      blendableBuckets: buckets.reduce((acc, b) => acc + (b.willBlend ? 1 : 0), 0),
      buckets,
    };
  }

  /** Tries cuid PK first, then the human-readable lot_id code. */
  private async resolveLot(
    param: string,
  ): Promise<{ id: string; lot_id: string } | null> {
    const byPk = await this.prisma.lot.findUnique({
      where: { id: param },
      select: { id: true, lot_id: true },
    });
    if (byPk) return byPk;
    return this.prisma.lot.findFirst({
      where: { lot_id: param },
      select: { id: true, lot_id: true },
    });
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
