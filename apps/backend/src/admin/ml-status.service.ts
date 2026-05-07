import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/database.module';
import type {
  MaeHistoryPoint,
  ModelVersionInfo,
} from './ml-dashboard.renderer';

export interface MlCronRunDto {
  id: string;
  jobName: string;
  startedAt: string;
  completedAt: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  durationMs: number | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

export interface MlJobSummary {
  jobName: string;
  total: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  runningCount: number;
  successRate: number; // 0..1, computed over (success + failed) only
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
}

export interface MlStatusResponse {
  generatedAt: string;
  windowHours: number;
  jobs: MlJobSummary[];
  recentRuns: MlCronRunDto[];
}

/**
 * Read-only aggregator over `ml_cron_runs`.
 *
 * Exposed via /admin/ml-status. Designed to answer the demo-day question
 * "is the model alive?" in a single round trip:
 *   - Per-job summary (last 24h by default): success rate, last success,
 *     last failure + message.
 *   - The N most recent runs (any job) with full payload so an operator
 *     can spot-check what model_version produced predictions.
 *
 * Performance:
 *   - Both queries hit `idx_ml_cron_runs_job_started`, so they remain
 *     O(log n) as the table grows.
 *   - We cap `recentRuns` at 100 and aggregate in memory — the row count
 *     in the window will be O(few hundred) given the highest-frequency
 *     job (predict-short-term) runs ~96 times/day.
 */
@Injectable()
export class MlStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(options: {
    windowHours: number;
    recentLimit: number;
  }): Promise<MlStatusResponse> {
    const since = new Date(Date.now() - options.windowHours * 3_600_000);
    // Pull every run in the window, sorted newest-first. We need the full
    // rows for both the per-job rollup and the recentRuns slice, so do
    // it in one query.
    const rows = await this.prisma.mlCronRun.findMany({
      where: { started_at: { gte: since } },
      orderBy: { started_at: 'desc' },
    });

    const byJob = new Map<string, MlJobSummary>();
    for (const row of rows) {
      const existing = byJob.get(row.job_name) ?? {
        jobName: row.job_name,
        total: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        runningCount: 0,
        successRate: 0,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureMessage: null,
      };
      existing.total += 1;
      if (row.status === 'SUCCESS') existing.successCount += 1;
      else if (row.status === 'FAILED') existing.failedCount += 1;
      else if (row.status === 'SKIPPED') existing.skippedCount += 1;
      else existing.runningCount += 1;

      const startedIso = row.started_at.toISOString();
      // Rows arrive newest-first, so the FIRST row of each kind we see is
      // the most recent — only set `lastX` if not already populated.
      if (existing.lastRunAt === null) existing.lastRunAt = startedIso;
      if (row.status === 'SUCCESS' && existing.lastSuccessAt === null) {
        existing.lastSuccessAt = startedIso;
      }
      if (row.status === 'FAILED' && existing.lastFailureAt === null) {
        existing.lastFailureAt = startedIso;
        existing.lastFailureMessage = row.error_message;
      }
      byJob.set(row.job_name, existing);
    }

    // Compute success rate over completed (success + failed) runs only;
    // SKIPPED is a no-op (lock contention), RUNNING is in-flight.
    for (const summary of byJob.values()) {
      const completed = summary.successCount + summary.failedCount;
      summary.successRate =
        completed === 0 ? 0 : summary.successCount / completed;
    }

    return {
      generatedAt: new Date().toISOString(),
      windowHours: options.windowHours,
      jobs: Array.from(byJob.values()).sort((a, b) =>
        a.jobName.localeCompare(b.jobName),
      ),
      recentRuns: rows.slice(0, options.recentLimit).map((row) => ({
        id: row.id,
        jobName: row.job_name,
        startedAt: row.started_at.toISOString(),
        completedAt: row.completed_at?.toISOString() ?? null,
        status: row.status,
        durationMs: row.duration_ms,
        errorMessage: row.error_message,
        metadata: row.metadata as Record<string, unknown> | null,
      })),
    };
  }

  /**
   * Per-day mean absolute error of `predictions_short_term` vs realized
   * `occupancy_snapshots` for the most recent `days` calendar days
   * (UTC). Joined on lot + nearest snapshot within ±150s of
   * `target_time` so we don't double-count or miss the realized point.
   *
   * Both columns are rates on [0,1], so MAE is dimensionless.
   *
   * Returned chronologically (oldest first) so the renderer can plot
   * directly. Days with no realized samples are omitted (rather than
   * NaN-filled) — operators care about the trend, not the gaps.
   */
  async getShortTermMaeHistory(days: number): Promise<MaeHistoryPoint[]> {
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      throw new Error(`days must be an integer in [1,60], got ${days}`);
    }
    // Window the join: only realized predictions whose target_time has
    // already elapsed AND fall in the last `days` days. The ±150s join
    // matches our 5-min snapshot cadence (the closest snapshot is within
    // half an interval).
    const since = new Date(Date.now() - days * 86_400_000);
    type Row = { day: Date; mae: number; sample_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        date_trunc('day', p.target_time) AS day,
        AVG(ABS(p.predicted_occupancy - s.occupancy_rate))::float AS mae,
        COUNT(*)::bigint AS sample_count
      FROM predictions_short_term p
      JOIN LATERAL (
        SELECT occupancy_rate
        FROM occupancy_snapshots
        WHERE lot_id = p.lot_id
          AND timestamp BETWEEN p.target_time - INTERVAL '150 seconds'
                            AND p.target_time + INTERVAL '150 seconds'
        ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - p.target_time)))
        LIMIT 1
      ) s ON TRUE
      WHERE p.target_time >= ${since}
        AND p.target_time <= NOW()
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      mae: r.mae,
      sampleCount: Number(r.sample_count),
    }));
  }

  /**
   * Latest production `model_version` per horizon, extracted from the
   * most recent SUCCESS row of each `predict-{short,long}-term` cron.
   * The `ML_RESULT` metadata is the source of truth (predict scripts
   * print `{"model_version": "...", "horizon": "short_term"|"long_term"}`).
   */
  async getLatestModelVersions(): Promise<ModelVersionInfo[]> {
    const horizons: Array<{ horizon: 'short_term' | 'long_term'; jobName: string }> = [
      { horizon: 'short_term', jobName: 'predict-short-term' },
      { horizon: 'long_term', jobName: 'predict-long-term' },
    ];
    const out: ModelVersionInfo[] = [];
    for (const { horizon, jobName } of horizons) {
      const row = await this.prisma.mlCronRun.findFirst({
        where: { job_name: jobName, status: 'SUCCESS' },
        orderBy: { started_at: 'desc' },
      });
      const meta = row?.metadata as Record<string, unknown> | null;
      const modelVersion =
        meta && typeof meta.model_version === 'string'
          ? meta.model_version
          : null;
      out.push({
        horizon,
        modelVersion,
        lastSuccessAt: row?.started_at.toISOString() ?? null,
      });
    }
    return out;
  }
}
