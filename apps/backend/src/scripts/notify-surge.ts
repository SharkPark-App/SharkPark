import { runCronJob } from './_bootstrap';
import { NotificationsService } from '../notifications/notifications.service';

const SNAPSHOT_WINDOW_MS = 20 * 60 * 1000;
// Surge is a campus-wide condition — don't re-alert any user for 2 hours
const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000;

void runCronJob('notify-surge', async ({ app, prisma, logger }) => {
  const svc = app.get(NotificationsService);
  const since = new Date(Date.now() - SNAPSHOT_WINDOW_MS);

  // Any lot above 90% constitutes a surge — take one to identify the school
  const surgeSnapshot = await prisma.occupancySnapshot.findFirst({
    where: { occupancy_rate: { gt: 0.9 }, timestamp: { gte: since } },
    select: { lot: { select: { school_id: true } } },
  });

  if (!surgeSnapshot) {
    logger.log('[cron:notify-surge] no lots above 90%');
    return;
  }

  const schoolId = surgeSnapshot.lot.school_id;
  logger.log(`[cron:notify-surge] surge detected at school ${schoolId}`);

  const users = await prisma.user.findMany({
    where: {
      school_id: schoolId,
      notification_preferences: { path: ['surge_alerts'], equals: true },
    },
    select: { id: true },
  });

  let sent = 0;
  for (const { id: userId } of users) {
    // Dedup without a contextId — one surge alert per user per window
    if (await svc.hasRecentLog(userId, 'surge', DEDUP_WINDOW_MS)) continue;

    const pushed = await svc.sendPush(userId, {
      title: 'Campus parking surge',
      body: 'Multiple lots are over 90% full. Plan extra time to find parking.',
      data: { type: 'surge' },
    });
    if (pushed) {
      await svc.logNotification(userId, 'surge');
      sent++;
    }
  }

  logger.log(`[cron:notify-surge] sent ${sent} notifications`);
});
