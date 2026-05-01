import { runCronJob } from './_bootstrap';
import { NotificationsService } from '../notifications/notifications.service';

// Alert window: treat a snapshot from the last 20 min as "current" to
// tolerate minor clock drift or a slightly late cron tick
const SNAPSHOT_WINDOW_MS = 20 * 60 * 1000;
// Dedup: don't re-alert the same user about the same lot within 4 hours
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000;

void runCronJob('notify-favorites-filling', async ({ app, prisma, logger }) => {
  const svc = app.get(NotificationsService);
  const since = new Date(Date.now() - SNAPSHOT_WINDOW_MS);

  // Lots that crossed 80% in the current snapshot window
  const highLots = await prisma.occupancySnapshot.findMany({
    where: { occupancy_rate: { gt: 0.8 }, timestamp: { gte: since } },
    select: { lot_id: true, lot: { select: { display_name: true } } },
    distinct: ['lot_id'],
  });

  if (highLots.length === 0) {
    logger.log('[cron:notify-favorites-filling] no lots above 80%');
    return;
  }

  logger.log(`[cron:notify-favorites-filling] ${highLots.length} lots above 80%`);

  let sent = 0;
  for (const { lot_id, lot } of highLots) {
    const favorites = await prisma.userFavorite.findMany({
      where: {
        lot_id,
        user: { notification_preferences: { path: ['favorites_filling'], equals: true } },
      },
      select: { user_id: true },
    });

    for (const { user_id } of favorites) {
      if (await svc.hasRecentLog(user_id, 'favorites_filling', DEDUP_WINDOW_MS, lot_id)) continue;

      const pushed = await svc.sendPush(user_id, {
        title: `${lot.display_name} is filling up`,
        body: 'Your favorite lot is over 80% full — park soon.',
        data: { type: 'favorites_filling', lotId: lot_id },
      });
      if (pushed) {
        await svc.logNotification(user_id, 'favorites_filling', lot_id);
        sent++;
      }
    }
  }

  logger.log(`[cron:notify-favorites-filling] sent ${sent} notifications`);
});
