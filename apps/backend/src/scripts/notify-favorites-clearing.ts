import { NotificationType } from '@prisma/client';
import { runCronJob } from './_bootstrap';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';

const SNAPSHOT_WINDOW_MS = 20 * 60 * 1000;
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000;

void runCronJob('notify-favorites-clearing', [NotificationsModule], async ({ app, prisma, logger }) => {
  const svc = app.get(NotificationsService);
  const now = Date.now();
  const recentCutoff = new Date(now - SNAPSHOT_WINDOW_MS);
  // The immediately-prior snapshot window: the 20 minutes before recentCutoff
  const priorWindowCutoff = new Date(recentCutoff.getTime() - SNAPSHOT_WINDOW_MS);

  // Lots currently below 30%
  const lowNow = await prisma.occupancySnapshot.findMany({
    where: { occupancy_rate: { lt: 0.3 }, timestamp: { gte: recentCutoff } },
    select: { lot_id: true, lot: { select: { display_name: true } } },
    distinct: ['lot_id'],
  });

  if (lowNow.length === 0) {
    logger.log('[cron:notify-favorites-clearing] no lots below 30%');
    return;
  }

  // Keep only lots whose peak in the immediately-prior window was above 75%,
  // so we catch lots that just cleared rather than ones that drifted down over hours.
  const clearingLots: { lot_id: string; display_name: string }[] = [];
  for (const { lot_id, lot } of lowNow) {
    const { _max } = await prisma.occupancySnapshot.aggregate({
      where: { lot_id, timestamp: { gte: priorWindowCutoff, lt: recentCutoff } },
      _max: { occupancy_rate: true },
    });
    if ((_max.occupancy_rate ?? 0) > 0.75) clearingLots.push({ lot_id, display_name: lot.display_name });
  }

  if (clearingLots.length === 0) {
    logger.log('[cron:notify-favorites-clearing] no lots transitioning from high to low');
    return;
  }

  logger.log(`[cron:notify-favorites-clearing] ${clearingLots.length} lots clearing`);

  let sent = 0;
  for (const { lot_id, display_name } of clearingLots) {
    const favorites = await prisma.userFavorite.findMany({
      where: {
        lot_id,
        user: { notification_preferences: { path: ['favorites_clearing'], equals: true } },
      },
      select: { user_id: true },
    });

    const userIds = favorites.map((f) => f.user_id);
    const alreadyNotified = await svc.recentlyNotifiedUsers(userIds, NotificationType.FAVORITES_CLEARING, DEDUP_WINDOW_MS, { lotId: lot_id });

    for (const { user_id } of favorites) {
      if (alreadyNotified.has(user_id)) continue;

      const pushed = await svc.sendPush(user_id, {
        title: `${display_name} is clearing up`,
        body: 'Your favorite lot dropped below 30% — spots are opening up.',
        data: { type: 'favorites_clearing', lotId: lot_id },
      });
      if (pushed) {
        await svc.logNotification(user_id, NotificationType.FAVORITES_CLEARING, { lotId: lot_id });
        sent++;
      }
    }
  }

  logger.log(`[cron:notify-favorites-clearing] sent ${sent} notifications`);
});
