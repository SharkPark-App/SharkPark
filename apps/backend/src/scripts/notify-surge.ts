import { NotificationType } from '@prisma/client';
import { runCronJob } from './_bootstrap';
import { NotificationsService } from '../notifications/notifications.service';

const SNAPSHOT_WINDOW_MS = 20 * 60 * 1000;
// Surge is a campus-wide condition — don't re-alert any user for 2 hours
const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000;

void runCronJob('notify-surge', async ({ app, prisma, logger }) => {
  const svc = app.get(NotificationsService);
  const since = new Date(Date.now() - SNAPSHOT_WINDOW_MS);

  const surgingSchools = await prisma.occupancySnapshot.findMany({
    where: { occupancy_rate: { gt: 0.9 }, timestamp: { gte: since } },
    select: { lot: { select: { school_id: true } } },
    distinct: ['lot_id'],
  });

  if (surgingSchools.length === 0) {
    logger.log('[cron:notify-surge] no lots above 90%');
    return;
  }

  const schoolIds = [...new Set(surgingSchools.map((s) => s.lot.school_id))];
  logger.log(`[cron:notify-surge] surge detected at schools: ${schoolIds.join(', ')}`);

  let sent = 0;
  for (const schoolId of schoolIds) {
    const users = await prisma.user.findMany({
      where: {
        school_id: schoolId,
        notification_preferences: { path: ['surge_alerts'], equals: true },
      },
      select: { id: true },
    });

    const userIds = users.map((u) => u.id);
    const alreadyNotified = await svc.recentlyNotifiedUsers(userIds, NotificationType.SURGE, DEDUP_WINDOW_MS);

    for (const { id: userId } of users) {
      if (alreadyNotified.has(userId)) continue;

      const pushed = await svc.sendPush(userId, {
        title: 'Campus parking surge',
        body: 'Multiple lots are over 90% full. Plan extra time to find parking.',
        data: { type: 'surge' },
      });
      if (pushed) {
        await svc.logNotification(userId, NotificationType.SURGE);
        sent++;
      }
    }
  }

  logger.log(`[cron:notify-surge] sent ${sent} notifications`);
});
