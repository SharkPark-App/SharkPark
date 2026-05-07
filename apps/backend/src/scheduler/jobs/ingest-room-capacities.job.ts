import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { CronRunnerService, type CronWorkMetadata } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';
import { spawnPythonModule } from './_ml-runner';
import { parseMlResult } from './_ml-result';

const NAME = 'ingest-room-capacities';

/**
 * Weekly (Sat 02:00 PT) scrape of CSULB's public Academic Scheduling
 * reference tables (auditorium / active-learning / conflict-off /
 * building codes) plus the per-term lecture-room-allocations page into
 * `room_capacities` and `Building.alternate_names`.
 *
 * Why Saturday 02:00 (not bundled into the catalog ingest itself):
 *  1. Runs **before** the Sunday 03:00 catalog ingest, so the catalog
 *     parser always sees fresh per-(building, room) seat counts and
 *     building aliases on its very next run.
 *  2. Splitting the two scrapes into independent crons gives Sentry
 *     monitor independence — a transient HTML breakage on one source
 *     doesn't mask the other in the dashboard.
 *
 * Implemented as a thin spawn wrapper around
 * `services/ml/scripts/ingest_room_capacities.py` so the parsing,
 * source-priority dedup, and DB upsert all live in Python where the
 * pytest suite covers them.
 *
 * Idempotency: the script issues `INSERT ... ON CONFLICT (school_id,
 * building_code, room) DO UPDATE SET capacity, source, fetched_at`.
 * There is no operator-wins clause for this table — every row is
 * sourced from the public scrape. The operator escape hatch lives in
 * `section_enrollment_overrides` (a separate table the catalog ingest
 * consults at the highest tier of its enrollment-resolution waterfall).
 */
@Injectable()
export class IngestRoomCapacitiesJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async (): Promise<CronWorkMetadata | void> => {
      const result = await spawnPythonModule(
        'scripts.ingest_room_capacities',
        [],
        {
          // Five HTTP fetches (one academic-scheduling page + one
          // lecture-allocation page; the script does not paginate). Each
          // is a single GET to www.csulb.edu, ~1-2s. Real wall-clock is
          // <30s; 10-min cap absorbs transient DNS / connect-timeout
          // hiccups without flapping the Sentry monitor.
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
          `ingest_room_capacities exited ${result.exitCode}; stderr tail:\n${result.stderrTail}`,
        );
      }

      return parseMlResult(result.stdoutTail) ?? undefined;
    });
  }
}
