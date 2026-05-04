import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';
import { NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/database.module';
import { NotificationsService } from '../../notifications/notifications.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'notify-favorites-filling';
const SNAPSHOT_WINDOW_MS = 20 * 60 * 1000;
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000;

@Injectable()
export class NotifyFavoritesFillingJob {
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

      const highLots = await this.prisma.occupancySnapshot.findMany({
        where: { occupancy_rate: { gt: 0.8 }, timestamp: { gte: since } },
        select: { lot_id: true, lot: { select: { display_name: true } } },
        distinct: ['lot_id'],
      });

      if (highLots.length === 0) {
        this.logger.log(`[cron:${NAME}] no lots above 80%`);
        return;
      }

      this.logger.log(`[cron:${NAME}] ${highLots.length} lots above 80%`);

      let sent = 0;
      for (const { lot_id, lot } of highLots) {
        const favorites = await this.prisma.userFavorite.findMany({
          where: {
            lot_id,
            user: {
              notification_preferences: {
                path: ['favorites_filling'],
                equals: true,
              },
            },
          },
          select: { user_id: true },
        });

        const userIds = favorites.map((f) => f.user_id);
        const alreadyNotified = await this.notifications.recentlyNotifiedUsers(
          userIds,
          NotificationType.FAVORITES_FILLING,
          DEDUP_WINDOW_MS,
          { lotId: lot_id },
        );

        for (const { user_id } of favorites) {
          if (alreadyNotified.has(user_id)) continue;
          const pushed = await this.notifications.sendPush(user_id, {
            title: `${lot.display_name} is filling up`,
            body: 'Your favorite lot is over 80% full — park soon.',
            data: { type: 'favorites_filling', lotId: lot_id },
          });
          if (pushed) {
            await this.notifications.logNotification(
              user_id,
              NotificationType.FAVORITES_FILLING,
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
