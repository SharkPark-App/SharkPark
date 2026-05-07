import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { CronRunnerService, type CronWorkMetadata } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';
import { spawnPythonModule } from './_ml-runner';
import { parseMlResult } from './_ml-result';

const NAME = 'build-proximity-matrix';

/**
 * Weekly (Sat 02:30 PT) recompute of the `lot_building_proximity`
 * matrix used by the D4 synthetic generator's softmax walk-distance
 * term.
 *
 * Why a separate cron (not bundled into ingest-room-capacities):
 *  1. Stays a pure-numeric job — no HTTP, no HTML, no Sentry monitor
 *     noise from upstream CSULB outages.
 *  2. Runs 30 min AFTER ingest-room-capacities so any new buildings
 *     added by that scrape appear in the matrix on the same Saturday.
 *  3. Independent monitor → if the haversine/upsert path breaks we see
 *     it without the room-capacities scrape masking the failure.
 *
 * Implemented as a thin spawn wrapper around
 * `services/ml/scripts/build_proximity_matrix.py`. The script handles
 * idempotency via `INSERT ... ON CONFLICT (lot_id, building_id)
 * DO UPDATE` and removes stale (out-of-range / deleted) pairs in the
 * same transaction, so re-runs are safe.
 */
@Injectable()
export class BuildProximityMatrixJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async (): Promise<CronWorkMetadata | void> => {
      const result = await spawnPythonModule(
        'scripts.build_proximity_matrix',
        [],
        {
          // Pure compute + a single transactional upsert. Sub-5s at
          // CSULB scale; 5-min cap absorbs DB connection setup or a
          // contended write lock without flapping the Sentry monitor.
          timeoutMs: 5 * 60 * 1000,
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
          `build_proximity_matrix exited ${result.exitCode}; stderr tail:\n${result.stderrTail}`,
        );
      }

      return parseMlResult(result.stdoutTail) ?? undefined;
    });
  }
}
