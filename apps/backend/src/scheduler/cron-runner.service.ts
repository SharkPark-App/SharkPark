import { Injectable } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

import { PrismaService } from '../database/database.module';
import { withAdvisoryLock } from './advisory-lock';
import {
  CRON_MONITORS,
  CRON_TIMEZONE,
  type CronJobName,
} from './cron-monitors';

/**
 * Per-tick wrapper for every scheduled job.
 *
 * Responsibilities (mirrors the old `runCronJob` in `src/scripts/_bootstrap.ts`,
 * minus the per-tick Nest bootstrap that we no longer need):
 *
 *   1. Open a Sentry check-in BEFORE doing any work, including the
 *      schedule/timezone/margin/maxRuntime so Sentry auto-creates the monitor
 *      on first contact (no manual UI setup).
 *   2. Acquire a Postgres advisory lock keyed by the job name. If the lock is
 *      busy (another cron Machine during a rolling deploy), skip silently —
 *      log it, close the check-in as `ok` to avoid a false-positive "missed"
 *      alert on this instance, and return.
 *   3. Run the job's `work` function inside the lock.
 *   4. On success: log + close check-in as `ok`.
 *   5. On error: log + capture exception in Sentry + close check-in as
 *      `error`. We RE-THROW so `@nestjs/schedule` knows the tick failed
 *      (which it logs but does not retry — desired, since we run again on
 *      the next tick).
 *
 * This service is injected into every job class; jobs don't have to know
 * about Sentry or advisory locks themselves.
 */
@Injectable()
export class CronRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async run(jobName: CronJobName, work: () => Promise<void>): Promise<void> {
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
      } else {
        this.logger.log(`[cron:${jobName}] complete (${elapsedMs}ms)`);
      }

      if (checkInId) {
        Sentry.captureCheckIn({
          checkInId,
          monitorSlug: jobName,
          status: 'ok',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`[cron:${jobName}] failed: ${message}`, stack);

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
}
