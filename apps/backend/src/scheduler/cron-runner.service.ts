import { Injectable } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/database.module';
import { withAdvisoryLock } from './advisory-lock';
import {
  CRON_MONITORS,
  CRON_TIMEZONE,
  type CronJobName,
} from './cron-monitors';

/**
 * Optional metadata returned by a tracked job's `work()` callback. Stored
 * verbatim into `ml_cron_runs.metadata` so /admin/ml-status can surface
 * model_version, predictions_written, mae, etc. without a schema change.
 */
export type CronWorkMetadata = Record<string, unknown>;

/**
 * Per-tick wrapper for every scheduled job.
 *
 * Responsibilities (mirrors the old `runCronJob` in `src/scripts/_bootstrap.ts`,
 * minus the per-tick Nest bootstrap that we no longer need):
 *
 *   1. Open a Sentry check-in BEFORE doing any work, including the
 *      schedule/timezone/margin/maxRuntime so Sentry auto-creates the monitor
 *      on first contact (no manual UI setup).
 *   2. If `CRON_MONITORS[jobName].track === true`, INSERT an `ml_cron_runs`
 *      row with status=RUNNING. (Skipped for non-tracked jobs to keep the
 *      table focused on ML-relevant runs.)
 *   3. Acquire a Postgres advisory lock keyed by the job name. If the lock is
 *      busy (another cron Machine during a rolling deploy), skip silently —
 *      log it, close the check-in as `ok` to avoid a false-positive "missed"
 *      alert on this instance, mark the tracked row SKIPPED, and return.
 *   4. Run the job's `work` function inside the lock.
 *   5. On success: log + close check-in `ok` + UPDATE tracked row SUCCESS
 *      with duration_ms and any metadata returned from work().
 *   6. On error: log + capture exception in Sentry + close check-in `error`
 *      + UPDATE tracked row FAILED with error_message. Re-throw so
 *      `@nestjs/schedule` knows the tick failed (it logs but does not
 *      retry — desired, since we run again on the next tick).
 *
 * This service is injected into every job class; jobs don't have to know
 * about Sentry, advisory locks, or ml_cron_runs themselves.
 */
@Injectable()
export class CronRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async run(
    jobName: CronJobName,
    work: () => Promise<void | CronWorkMetadata>,
  ): Promise<void> {
    const monitorConfig = CRON_MONITORS[jobName];
    let checkInId: string | undefined;
    if (process.env.SENTRY_DSN) {
      checkInId = Sentry.captureCheckIn(
        { monitorSlug: jobName, status: 'in_progress' },
        {
          schedule: { type: 'crontab', value: monitorConfig.schedule },
          checkinMargin: monitorConfig.checkinMargin,
          maxRuntime: monitorConfig.maxRuntime,
          timezone: CRON_TIMEZONE,
        },
      );
    }

    // Track row is created BEFORE the advisory lock so we still record an
    // audit entry on the instance that lost the race (status=SKIPPED).
    // CRON_MONITORS uses `as const`, so entries without `track` lack the
    // property at the type level — narrow via `in` before the boolean check.
    const isTracked =
      'track' in monitorConfig && monitorConfig.track === true;
    let trackedRunId: string | undefined;
    if (isTracked) {
      try {
        const row = await this.prisma.mlCronRun.create({
          data: { job_name: jobName, status: 'RUNNING' },
          select: { id: true },
        });
        trackedRunId = row.id;
      } catch (err) {
        // Audit insertion failures must NOT prevent the actual job from
        // running — log + continue. The Sentry check-in already covers the
        // operational alerting path.
        this.logger.warn(
          `[cron:${jobName}] failed to insert ml_cron_runs row: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(`[cron:${jobName}] starting`);
    const startedAt = Date.now();

    try {
      const outcome = await withAdvisoryLock(
        this.prisma.pool,
        jobName,
        work,
      );

      const elapsedMs = Date.now() - startedAt;
      if (!outcome.acquired) {
        this.logger.log(
          `[cron:${jobName}] another instance holds the lock — skipping (${elapsedMs}ms)`,
        );
        await this._finalizeTrackedRun(trackedRunId, {
          status: 'SKIPPED',
          duration_ms: elapsedMs,
        });
      } else {
        this.logger.log(`[cron:${jobName}] complete (${elapsedMs}ms)`);
        const metadata = (outcome.result ?? undefined) as
          | CronWorkMetadata
          | undefined;
        await this._finalizeTrackedRun(trackedRunId, {
          status: 'SUCCESS',
          duration_ms: elapsedMs,
          metadata: this._toJsonValue(metadata),
        });
        // Drift detection: if the current run's model_version differs from
        // the previous SUCCESS run for this job, surface a Sentry warning.
        // A model_version change is intentional during a deploy, but a
        // silent change between deploys (e.g. a stale artifact, a typo, or
        // an unexpected MLflow promotion) is exactly the kind of thing we
        // want to know about. Best-effort — never fail the run.
        await this._checkModelVersionDrift(jobName, metadata);
      }

      if (checkInId) {
        Sentry.captureCheckIn({
          checkInId,
          monitorSlug: jobName,
          status: 'ok',
        });
      }
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`[cron:${jobName}] failed: ${message}`, stack);

      await this._finalizeTrackedRun(trackedRunId, {
        status: 'FAILED',
        duration_ms: elapsedMs,
        // 16000 chars: schema column is unconstrained TEXT and Python ML
        // tracebacks regularly exceed 4 KB. Keep an upper bound so a
        // pathological error string can't bloat the audit table.
        error_message: message.slice(0, 16000),
      });

      if (checkInId) {
        Sentry.captureCheckIn({
          checkInId,
          monitorSlug: jobName,
          status: 'error',
        });
      }
      if (err instanceof Error) {
        Sentry.captureException(err);
      }
      // Re-throw so @nestjs/schedule's runtime sees the failure and logs it
      // through its own error handler. The next scheduled tick still fires.
      throw err;
    }
  }

  private async _finalizeTrackedRun(
    runId: string | undefined,
    update: {
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
      duration_ms: number;
      error_message?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    if (!runId) return;
    try {
      await this.prisma.mlCronRun.update({
        where: { id: runId },
        data: {
          completed_at: new Date(),
          status: update.status,
          duration_ms: update.duration_ms,
          ...(update.error_message
            ? { error_message: update.error_message }
            : {}),
          ...(update.metadata !== undefined
            ? { metadata: update.metadata }
            : {}),
        },
      });
    } catch (err) {
      // A tracked-row update failure is non-fatal: the job already ran.
      // Surface a warning so an operator notices the audit gap.
      this.logger.warn(
        `[cron] failed to finalize ml_cron_runs row ${runId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Compare the current run's `model_version` against the previous
   * SUCCESS run for the same job. Emits a Sentry warning when they
   * differ so an operator can confirm the change was intentional.
   * Silent on first run (no prior SUCCESS), missing model_version, or
   * any DB/Sentry error — drift detection must never fail a job.
   */
  private async _checkModelVersionDrift(
    jobName: string,
    metadata: CronWorkMetadata | undefined,
  ): Promise<void> {
    const current = metadata?.['model_version'];
    if (typeof current !== 'string' || current.length === 0) return;
    try {
      const previous = await this.prisma.mlCronRun.findFirst({
        where: {
          job_name: jobName,
          status: 'SUCCESS',
          metadata: { path: ['model_version'], not: Prisma.AnyNull },
        },
        orderBy: { completed_at: 'desc' },
        // skip:1 because the row we just wrote is the freshest SUCCESS.
        skip: 1,
        select: { metadata: true },
      });
      if (!previous?.metadata) return;
      const prev = (previous.metadata as Record<string, unknown>)[
        'model_version'
      ];
      if (typeof prev !== 'string' || prev === current) return;
      const msg = `[cron:${jobName}] model_version drift: was "${prev}", now "${current}"`;
      this.logger.warn(msg);
      Sentry.captureMessage(msg, {
        level: 'warning',
        tags: { job: jobName, kind: 'model_version_drift' },
        extra: { previous_version: prev, current_version: current },
      });
    } catch (err) {
      this.logger.warn(
        `[cron:${jobName}] model_version drift check failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Coerce arbitrary work() metadata into a Prisma-compatible JSON value.
   * Drops anything that doesn't survive `JSON.stringify` (functions, undefined,
   * BigInt) so a stray non-serializable field can't blow up the UPDATE.
   */
  private _toJsonValue(
    value: CronWorkMetadata | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }
}
