import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

import { PrismaService } from '../../database/database.module';
import { CronRunnerService, type CronWorkMetadata } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'prediction-accuracy';

/**
 * Window over which we score predictions made yesterday against the
 * occupancy snapshots they targeted. Snapshots are written at :00/:15/:30/:45,
 * predictions target arbitrary clock times — match each prediction to the
 * single nearest snapshot within ±MATCH_TOLERANCE_MIN.
 */
const LOOKBACK_HOURS = 25;
const MATCH_TOLERANCE_MIN = 8; // ≤ half the 15-min snapshot cadence

interface PerLotAccuracy {
  lot_id: string;
  predictions_evaluated: number;
  predictions_matched: number;
  mae_rate: number; // mean abs error in [0, 1] occupancy-rate space
  rmse_rate: number;
  coverage: number; // matched / evaluated, [0, 1]
}

interface PredictionRow {
  lot_id: string;
  target_time: Date;
  predicted_occupancy: number; // rate [0, 1]
  confidence_lower: number;
  confidence_upper: number;
}

interface SnapshotRow {
  lot_id: string;
  timestamp: Date;
  occupancy_rate: number; // [0, 1]
}

/**
 * Daily drift-detection cron: compare yesterday's `predictions_short_term`
 * against the matching `occupancy_snapshots` and emit per-lot MAE / RMSE /
 * coverage / interval-hit-rate to Sentry as a structured info message
 * (tags + extra) so it's queryable from the Issues UI.
 *
 * Why this exists: the audit (§3 MEDIUM-6) flagged the absence of any
 * automated prediction-vs-actual feedback loop. Training-time MAE is
 * tracked in MLflow, but live drift was previously only inspectable via
 * the admin endpoints. This job closes the loop and gives ops a single
 * Sentry issue to alert on when global MAE crosses a threshold.
 *
 * Schedule: 15 5 * * * PT — late enough that yesterday's last snapshot
 * (23:45 PT) is durably written, early enough to alert before peak.
 */
@Injectable()
export class PredictionAccuracyJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async (): Promise<CronWorkMetadata | void> => {
      const now = new Date();
      const windowStart = new Date(now.getTime() - LOOKBACK_HOURS * 3600 * 1000);
      const windowEnd = now;

      const predictions = (await this.prisma.predictionShortTerm.findMany({
        where: { target_time: { gte: windowStart, lt: windowEnd } },
        select: {
          lot_id: true,
          target_time: true,
          predicted_occupancy: true,
          confidence_lower: true,
          confidence_upper: true,
        },
      })) as PredictionRow[];

      if (predictions.length === 0) {
        this.logger.warn(
          `[cron:${NAME}] no predictions in window ${windowStart.toISOString()}..${windowEnd.toISOString()}; skipping`,
        );
        return { skipped: true, reason: 'no_predictions_in_window' };
      }

      // Pull snapshots for the same window in one round-trip; matching is
      // done in memory because the predictions/snapshots table sizes per
      // day are small (≈70 lots × 56 ticks/day = ≤4k rows each).
      const snapshots = (await this.prisma.occupancySnapshot.findMany({
        where: {
          timestamp: {
            gte: new Date(windowStart.getTime() - MATCH_TOLERANCE_MIN * 60_000),
            lt: new Date(windowEnd.getTime() + MATCH_TOLERANCE_MIN * 60_000),
          },
        },
        select: { lot_id: true, timestamp: true, occupancy_rate: true },
        orderBy: { timestamp: 'asc' },
      })) as SnapshotRow[];

      const snapshotsByLot = new Map<string, SnapshotRow[]>();
      for (const s of snapshots) {
        const list = snapshotsByLot.get(s.lot_id);
        if (list) list.push(s);
        else snapshotsByLot.set(s.lot_id, [s]);
      }

      const perLot = new Map<string, {
        evaluated: number;
        matched: number;
        absErrSum: number;
        sqErrSum: number;
        ciHit: number;
      }>();

      const toleranceMs = MATCH_TOLERANCE_MIN * 60_000;
      let globalAbsErrSum = 0;
      let globalSqErrSum = 0;
      let globalMatched = 0;
      let globalCiHit = 0;

      for (const p of predictions) {
        const bucket =
          perLot.get(p.lot_id) ?? {
            evaluated: 0,
            matched: 0,
            absErrSum: 0,
            sqErrSum: 0,
            ciHit: 0,
          };
        bucket.evaluated += 1;

        const candidates = snapshotsByLot.get(p.lot_id);
        if (candidates && candidates.length > 0) {
          const targetMs = p.target_time.getTime();
          const nearest = nearestByTime(candidates, targetMs);
          if (nearest && Math.abs(nearest.timestamp.getTime() - targetMs) <= toleranceMs) {
            const err = p.predicted_occupancy - nearest.occupancy_rate;
            const absErr = Math.abs(err);
            bucket.matched += 1;
            bucket.absErrSum += absErr;
            bucket.sqErrSum += err * err;
            globalMatched += 1;
            globalAbsErrSum += absErr;
            globalSqErrSum += err * err;
            if (
              nearest.occupancy_rate >= p.confidence_lower &&
              nearest.occupancy_rate <= p.confidence_upper
            ) {
              bucket.ciHit += 1;
              globalCiHit += 1;
            }
          }
        }

        perLot.set(p.lot_id, bucket);
      }

      const perLotResults: PerLotAccuracy[] = [];
      for (const [lot_id, b] of perLot.entries()) {
        if (b.matched === 0) {
          perLotResults.push({
            lot_id,
            predictions_evaluated: b.evaluated,
            predictions_matched: 0,
            mae_rate: 0,
            rmse_rate: 0,
            coverage: 0,
          });
          continue;
        }
        perLotResults.push({
          lot_id,
          predictions_evaluated: b.evaluated,
          predictions_matched: b.matched,
          mae_rate: b.absErrSum / b.matched,
          rmse_rate: Math.sqrt(b.sqErrSum / b.matched),
          coverage: b.matched / b.evaluated,
        });
      }

      const globalMae = globalMatched > 0 ? globalAbsErrSum / globalMatched : 0;
      const globalRmse = globalMatched > 0 ? Math.sqrt(globalSqErrSum / globalMatched) : 0;
      const globalCoverage = predictions.length > 0 ? globalMatched / predictions.length : 0;
      const globalIntervalHitRate = globalMatched > 0 ? globalCiHit / globalMatched : 0;

      this.logger.log(
        `[cron:${NAME}] window=${windowStart.toISOString()}..${windowEnd.toISOString()} ` +
          `lots=${perLotResults.length} predictions=${predictions.length} ` +
          `matched=${globalMatched} mae=${globalMae.toFixed(4)} ` +
          `rmse=${globalRmse.toFixed(4)} coverage=${globalCoverage.toFixed(3)} ` +
          `interval_hit=${globalIntervalHitRate.toFixed(3)}`,
        { perLot: perLotResults },
      );

      // Emit a single structured Sentry message so ops can alert on it
      // (e.g. "fire when global_mae > 0.15 sustained 3 days"). Tags are
      // used for fingerprinting/grouping; extras carry the per-lot table.
      Sentry.captureMessage(
        `[ml-drift] short-term MAE=${globalMae.toFixed(4)} coverage=${globalCoverage.toFixed(3)}`,
        {
          level: 'info',
          tags: {
            cron: NAME,
            horizon: 'short_term',
          },
          extra: {
            window_start: windowStart.toISOString(),
            window_end: windowEnd.toISOString(),
            global_mae_rate: globalMae,
            global_rmse_rate: globalRmse,
            global_coverage: globalCoverage,
            global_interval_hit_rate: globalIntervalHitRate,
            predictions_evaluated: predictions.length,
            predictions_matched: globalMatched,
            per_lot: perLotResults,
          },
        },
      );

      return {
        predictions_evaluated: predictions.length,
        predictions_matched: globalMatched,
        global_mae_rate: globalMae,
        global_rmse_rate: globalRmse,
        global_coverage: globalCoverage,
        global_interval_hit_rate: globalIntervalHitRate,
      };
    });
  }
}

/**
 * Binary search for the snapshot whose timestamp is closest to `targetMs`.
 * `snapshots` MUST be sorted ascending by timestamp.
 */
function nearestByTime(snapshots: SnapshotRow[], targetMs: number): SnapshotRow | null {
  if (snapshots.length === 0) return null;
  let lo = 0;
  let hi = snapshots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (snapshots[mid].timestamp.getTime() < targetMs) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first snapshot >= targetMs. Compare with the previous one.
  const candidates: SnapshotRow[] = [snapshots[lo]];
  if (lo > 0) candidates.push(snapshots[lo - 1]);
  let best = candidates[0];
  let bestDelta = Math.abs(best.timestamp.getTime() - targetMs);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(candidates[i].timestamp.getTime() - targetMs);
    if (d < bestDelta) {
      best = candidates[i];
      bestDelta = d;
    }
  }
  return best;
}
