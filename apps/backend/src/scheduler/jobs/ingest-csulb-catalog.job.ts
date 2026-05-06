import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { CronRunnerService, type CronWorkMetadata } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';
import { spawnPythonModule } from './_ml-runner';
import { parseMlResult } from './_ml-result';

const NAME = 'ingest-csulb-catalog';

/**
 * Weekly (Sun 03:00 PT) ingest of the CSULB Schedule of Classes into
 * `course_meetings`. Powers the synthetic-v2 occupancy generator (D4) by
 * giving it real per-section enrollment and (building, room, day, time)
 * meeting blocks instead of the uniform-noise priors used by v1.
 *
 * Implemented as a thin spawn wrapper around
 * `services/ml/scripts/ingest_csulb_catalog.py` so the HTML parsing,
 * tiered enrollment fallback, and SQL upsert all live in Python where
 * the dedicated unit tests already cover them. No JS-side logic.
 *
 * Idempotency: the script issues `INSERT ... ON CONFLICT (school_id,
 * term, subject_code, course_code, section) DO UPDATE` with an operator-
 * wins clause that preserves any row whose `enrollment_source` is
 * `'override'` or `'sso'` (i.e. operator-curated truth). Re-running on
 * the same term safely refreshes meeting times / instructors / room
 * matches without clobbering manual edits.
 */
@Injectable()
export class IngestCsulbCatalogJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async (): Promise<CronWorkMetadata | void> => {
      const result = await spawnPythonModule(
        'scripts.ingest_csulb_catalog',
        [],
        {
          // CSULB has ~110 subject pages per term; average fetch ~1s with
          // single-connection requests Session + a 0.5s polite sleep
          // between pages. Worst case ~5 min wall-clock; cap at 30 to
          // tolerate cold DNS / transient rate-limiting without flapping.
          timeoutMs: 30 * 60 * 1000,
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
          `ingest_csulb_catalog exited ${result.exitCode}; stderr tail:\n${result.stderrTail}`,
        );
      }

      return parseMlResult(result.stdoutTail) ?? undefined;
    });
  }
}
