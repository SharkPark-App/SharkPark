import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';
import { NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/database.module';
import { NotificationsService } from '../../notifications/notifications.service';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'notify-events';
const LOOKAHEAD_MS = 2 * 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 3 * 60 * 60 * 1000;

function formatLocalTime(date: Date, tz: string): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

@Injectable()
export class NotifyEventsJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const now = new Date();
      const lookahead = new Date(now.getTime() + LOOKAHEAD_MS);

      const events = await this.prisma.campusEvent.findMany({
        where: { start_time: { gt: now, lte: lookahead } },
        select: {
          id: true,
          school_id: true,
          event_name: true,
          start_time: true,
          school: { select: { timezone: true } },
        },
      });

      if (events.length === 0) {
        this.logger.log(`[cron:${NAME}] no upcoming events in 2-hour window`);
        return;
      }

      this.logger.log(`[cron:${NAME}] ${events.length} upcoming events`);

      let sent = 0;
      for (const event of events) {
        const users = await this.prisma.user.findMany({
          where: {
            school_id: event.school_id,
            notification_preferences: {
              path: ['event_alerts'],
              equals: true,
            },
          },
          select: { id: true },
        });

        const startTime = formatLocalTime(event.start_time, event.school.timezone);
        const userIds = users.map((u) => u.id);
        const alreadyNotified = await this.notifications.recentlyNotifiedUsers(
          userIds,
          NotificationType.EVENTS,
          DEDUP_WINDOW_MS,
          { eventId: event.id },
        );

        for (const { id: userId } of users) {
          if (alreadyNotified.has(userId)) continue;
          const pushed = await this.notifications.sendPush(userId, {
            title: `${event.event_name} starts soon`,
            body: `Starting at ${startTime}. Expect heavier parking near campus.`,
            data: { type: 'events', eventId: event.id },
          });
          if (pushed) {
            await this.notifications.logNotification(
              userId,
              NotificationType.EVENTS,
              { eventId: event.id },
            );
            sent++;
          }
        }
      }

      this.logger.log(`[cron:${NAME}] sent ${sent} notifications`);
    });
  }
}
