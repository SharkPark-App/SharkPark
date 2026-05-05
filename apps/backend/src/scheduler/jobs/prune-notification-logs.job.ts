import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { NotificationsService } from '../../notifications/notifications.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'prune-notification-logs';
const DEFAULT_RETENTION_DAYS = 90;

function parseRetentionDays(): number {
  const raw = process.env.NOTIFICATION_LOG_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      `NOTIFICATION_LOG_RETENTION_DAYS must be a number >= 1, got "${raw}"`,
    );
  }
  return parsed;
}

/**
 * Daily cron: delete `notification_logs` rows older than the retention
 * window. Override with `NOTIFICATION_LOG_RETENTION_DAYS` (default 90).
 *
 * The dedup window read by `wasRecentlyNotified` is bounded explicitly
 * (`gte: since` with a millisecond `windowMs`), so older rows are pure
 * history. 90d is comfortably wider than any current dedup window
 * (longest is 30d for `notify-events`).
 */
@Injectable()
export class PruneNotificationLogsJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const retentionDays = parseRetentionDays();
      const result = await this.notifications.pruneOldLogs(retentionDays);
      this.logger.log(
        `[cron:${NAME}] retention=${retentionDays}d ` +
          `logs=${result.logs_deleted} cutoff=${result.cutoff}`,
      );
    });
  }
}
