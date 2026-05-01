import { runCronJob } from './_bootstrap';
import { NotificationsService } from '../notifications/notifications.service';

// Notify when an event starts within the next 2 hours
const LOOKAHEAD_MS = 2 * 60 * 60 * 1000;
// Dedup: one notification per user per event — stored with event.id in lot_id
const DEDUP_WINDOW_MS = 3 * 60 * 60 * 1000;

void runCronJob('notify-events', async ({ app, prisma, logger }) => {
  const svc = app.get(NotificationsService);
  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_MS);

  const events = await prisma.campusEvent.findMany({
    where: { start_time: { gt: now, lte: lookahead } },
    select: { id: true, school_id: true, event_name: true, start_time: true },
  });

  if (events.length === 0) {
    logger.log('[cron:notify-events] no upcoming events in 2-hour window');
    return;
  }

  logger.log(`[cron:notify-events] ${events.length} upcoming events`);

  let sent = 0;
  for (const event of events) {
    const users = await prisma.user.findMany({
      where: {
        school_id: event.school_id,
        notification_preferences: { path: ['event_alerts'], equals: true },
      },
      select: { id: true },
    });

    const startTime = event.start_time.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    });

    for (const { id: userId } of users) {
      // event.id stored in lot_id column to dedup per user + event pair
      if (await svc.hasRecentLog(userId, 'events', DEDUP_WINDOW_MS, event.id)) continue;

      const pushed = await svc.sendPush(userId, {
        title: `${event.event_name} starts soon`,
        body: `Starting at ${startTime}. Expect heavier parking near campus.`,
        data: { type: 'events', eventId: event.id },
      });
      if (pushed) {
        await svc.logNotification(userId, 'events', event.id);
        sent++;
      }
    }
  }

  logger.log(`[cron:notify-events] sent ${sent} notifications`);
});
