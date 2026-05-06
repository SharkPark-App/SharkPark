import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { CronRunnerService, type CronWorkMetadata } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';
import { spawnPythonModule } from './_ml-runner';
import { parseMlResult } from './_ml-result';

const NAME = 'recompute-penetration-rates';

/**
 * Daily (02:30 PT) recompute of `penetration_rate_estimates` from
 * yesterday's ground-truth consensus windows.
 *
 * Implemented as a thin spawn wrapper around
 * `services/ml/scripts/recompute_penetration_rates.py` — all math
 * lives in Python so the EWMA logic can be unit-tested with the rest
 * of the ML pipeline (no per-language drift).
 *
 * Idempotency note: the EWMA update is NOT idempotent within a single
 * local day (re-running today applies today's update twice). The cron
 * fires once daily; manual re-runs should pass `--date YYYY-MM-DD` and
 * the operator must accept the duplicate update. See the script's
 * module docstring for the rationale.
 */
@Injectable()
export class RecomputePenetrationRatesJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async (): Promise<CronWorkMetadata | void> => {
      const result = await spawnPythonModule(
        'scripts.recompute_penetration_rates',
        [],
        {
          // Generous cap — the script is a few SQL statements + Python math
          // over O(n_lots * 24 * 12) rows; should finish in seconds, but
          // give it 15 min before the runner aborts to avoid spurious
          // FAILED rows during cold-start under contention.
          timeoutMs: 15 * 60 * 1000,
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
          `recompute_penetration_rates exited ${result.exitCode}; stderr tail:\n${result.stderrTail}`,
        );
      }

      return parseMlResult(result.stdoutTail) ?? undefined;
    });
  }
}
