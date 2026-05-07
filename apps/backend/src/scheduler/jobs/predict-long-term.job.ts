import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { CronRunnerService, type CronWorkMetadata } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';
import { spawnPythonModule } from './_ml-runner';
import { parseMlResult } from './_ml-result';

const NAME = 'predict-long-term';

/**
 * Spawn the Python long-term predictor once per day at 1:05 AM PT — far
 * enough into the new day that yesterday's full hourly history is
 * settled, early enough that the 7-day forecast is on disk before
 * users open the app at sunrise.
 *
 * Idempotent: predict_long_term.py upserts on (lot_id, target_time).
 */
@Injectable()
export class PredictLongTermJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async (): Promise<CronWorkMetadata | void> => {
      const result = await spawnPythonModule(
        'scripts.predict_long_term',
        [],
        {
          // Hard-cap a single tick at 25 minutes (Sentry maxRuntime is 30).
          timeoutMs: 25 * 60 * 1000,
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
          `predict_long_term exited ${result.exitCode}; stderr tail:\n${result.stderrTail}`,
        );
      }

      return parseMlResult(result.stdoutTail) ?? undefined;
    });
  }
}
