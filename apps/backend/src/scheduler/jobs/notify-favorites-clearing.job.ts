import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';
import { NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/database.module';
import { NotificationsService } from '../../notifications/notifications.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'notify-favorites-clearing';
const SNAPSHOT_WINDOW_MS = 20 * 60 * 1000;
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000;

@Injectable()
export class NotifyFavoritesClearingJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const now = Date.now();
      const recentCutoff = new Date(now - SNAPSHOT_WINDOW_MS);
      const priorWindowCutoff = new Date(
        recentCutoff.getTime() - SNAPSHOT_WINDOW_MS,
      );

      const lowNow = await this.prisma.occupancySnapshot.findMany({
        where: { occupancy_rate: { lt: 0.3 }, timestamp: { gte: recentCutoff } },
        select: { lot_id: true, lot: { select: { display_name: true } } },
        distinct: ['lot_id'],
      });

      if (lowNow.length === 0) {
        this.logger.log(`[cron:${NAME}] no lots below 30%`);
        return;
      }

      const clearingLots: { lot_id: string; display_name: string }[] = [];
      for (const { lot_id, lot } of lowNow) {
        const { _max } = await this.prisma.occupancySnapshot.aggregate({
          where: {
            lot_id,
            timestamp: { gte: priorWindowCutoff, lt: recentCutoff },
          },
          _max: { occupancy_rate: true },
        });
        if ((_max.occupancy_rate ?? 0) > 0.75) {
          clearingLots.push({ lot_id, display_name: lot.display_name });
        }
      }

      if (clearingLots.length === 0) {
        this.logger.log(
          `[cron:${NAME}] no lots transitioning from high to low`,
        );
        return;
      }

      this.logger.log(`[cron:${NAME}] ${clearingLots.length} lots clearing`);

      let sent = 0;
      for (const { lot_id, display_name } of clearingLots) {
        const favorites = await this.prisma.userFavorite.findMany({
          where: {
            lot_id,
            user: {
              notification_preferences: {
                path: ['favorites_clearing'],
                equals: true,
              },
            },
          },
          select: { user_id: true },
        });

        const userIds = favorites.map((f) => f.user_id);
        const alreadyNotified = await this.notifications.recentlyNotifiedUsers(
          userIds,
          NotificationType.FAVORITES_CLEARING,
          DEDUP_WINDOW_MS,
          { lotId: lot_id },
        );

        for (const { user_id } of favorites) {
          if (alreadyNotified.has(user_id)) continue;
          const pushed = await this.notifications.sendPush(user_id, {
            title: `${display_name} is clearing up`,
            body: 'Your favorite lot dropped below 30% — spots are opening up.',
            data: { type: 'favorites_clearing', lotId: lot_id },
          });
          if (pushed) {
            await this.notifications.logNotification(
              user_id,
              NotificationType.FAVORITES_CLEARING,
              { lotId: lot_id },
            );
            sent++;
          }
        }
      }

      this.logger.log(`[cron:${NAME}] sent ${sent} notifications`);
    });
  }
}
