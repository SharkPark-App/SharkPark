import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { ReportsService } from '../../reports/reports.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'prune-old-report-messages';
const DEFAULT_RETENTION_DAYS = 90;

function parseRetentionDays(): number {
  const raw = process.env.REPORT_MESSAGE_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `REPORT_MESSAGE_RETENTION_DAYS must be a number >= 1, got "${raw}"`,
    );
  }
  return parsed;
}

/**
 * Weekly cron: redact (set `message = NULL`) on `reports` rows older than
 * `REPORT_MESSAGE_RETENTION_DAYS` (default 90). The row is preserved so
 * type + lot + timestamp remain available for trend analysis; only the
 * free-text message column (the only PII-bearing column) is dropped.
 */
@Injectable()
export class PruneOldReportMessagesJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly reports: ReportsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const retentionDays = parseRetentionDays();
      const result = await this.reports.pruneOldMessages(retentionDays);
      this.logger.log(
        `[cron:${NAME}] retention=${retentionDays}d ` +
          `redacted=${result.messages_redacted} cutoff=${result.cutoff}`,
      );
    });
  }
}
