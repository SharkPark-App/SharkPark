import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { CronRunnerService, type CronWorkMetadata } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';
import { spawnPythonModule } from './_ml-runner';
import { parseMlResult } from './_ml-result';

const NAME = 'predict-short-term';

/**
 * Spawn the Python short-term predictor every 15 minutes (offset 5 min
 * past the snapshot tick) so the freshest occupancy snapshot has been
 * written before features are built.
 *
 * Idempotent: predict_short_term.py upserts on (lot_id, target_time).
 *
 * The advisory lock in cron-runner already serializes concurrent ticks
 * across rolling deploys; the Python script also acquires its own
 * Postgres lock as defense-in-depth (independent of Node restarts).
 */
@Injectable()
export class PredictShortTermJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async (): Promise<CronWorkMetadata | void> => {
      const result = await spawnPythonModule(
        'scripts.predict_short_term',
        [],
        {
          // Hard-cap one tick at 10 minutes so a hung process can't
          // hold the advisory lock past the next scheduled tick. The
          // outer Sentry maxRuntime is 12 min so SIGTERM lands first.
          timeoutMs: 10 * 60 * 1000,
          onLog: (stream, line) => {
            if (stream === 'stderr') {
              this.logger.warn(`[cron:${NAME}] ${line}`);
            } else {
              this.logger.log(`[cron:${NAME}] ${line}`);
            }
          },
        },
      );

      if (result.exitCode !== 0) {
        throw new Error(
          `predict_short_term exited ${result.exitCode}; stderr tail:\n${result.stderrTail}`,
        );
      }

      // Parse the structured ML_RESULT marker the script prints just before
      // exit (model_version, predictions_written, ...). Returned to the
      // runner so it lands in `ml_cron_runs.metadata` for /admin/ml-status.
      return parseMlResult(result.stdoutTail) ?? undefined;
    });
  }
}
