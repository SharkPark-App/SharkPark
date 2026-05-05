import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';
import { NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/database.module';
import { NotificationsService } from '../../notifications/notifications.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'notify-surge';
const SNAPSHOT_WINDOW_MS = 20 * 60 * 1000;
const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class NotifySurgeJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const since = new Date(Date.now() - SNAPSHOT_WINDOW_MS);

      const surgingSchools = await this.prisma.occupancySnapshot.findMany({
        where: { occupancy_rate: { gt: 0.9 }, timestamp: { gte: since } },
        select: { lot: { select: { school_id: true } } },
        distinct: ['lot_id'],
      });

      if (surgingSchools.length === 0) {
        this.logger.log(`[cron:${NAME}] no lots above 90%`);
        return;
      }

      const schoolIds = [...new Set(surgingSchools.map((s) => s.lot.school_id))];
      this.logger.log(
        `[cron:${NAME}] surge detected at schools: ${schoolIds.join(', ')}`,
      );

      let sent = 0;
      for (const schoolId of schoolIds) {
        const users = await this.prisma.user.findMany({
          where: {
            school_id: schoolId,
            notification_preferences: { path: ['surge_alerts'], equals: true },
          },
          select: { id: true },
        });

        const userIds = users.map((u) => u.id);
        const alreadyNotified = await this.notifications.recentlyNotifiedUsers(
          userIds,
          NotificationType.SURGE,
          DEDUP_WINDOW_MS,
        );

        for (const { id: userId } of users) {
          if (alreadyNotified.has(userId)) continue;
          const pushed = await this.notifications.sendPush(userId, {
            title: 'Campus parking surge',
            body: 'Multiple lots are over 90% full. Plan extra time to find parking.',
            data: { type: 'surge' },
          });
          if (pushed) {
            await this.notifications.logNotification(
              userId,
              NotificationType.SURGE,
            );
            sent++;
          }
        }
      }

      this.logger.log(`[cron:${NAME}] sent ${sent} notifications`);
    });
  }
}
