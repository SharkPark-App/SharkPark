import { runCronJob } from './_bootstrap';
import { RedisModule } from '../redis/redis.module';
import { ShuttleTrackerModule } from '../shuttle-tracker/shuttle-tracker.module';
import { ShuttleTrackerService } from '../shuttle-tracker/shuttle-tracker.service';

// TODO: ShuttleTrackerModule pulls in PassioWebSocketService + Gateway, which
// open a WebSocket on bootstrap. Acceptable here because fetch-transit runs
// alone (daily, 0 0) and isn't part of the */15 cron cluster that drives RSS.
void runCronJob('fetch-transit', [RedisModule, ShuttleTrackerModule], async ({ app }) => {
  const svc = app.get(ShuttleTrackerService);
  await svc.fetchRoutesAndStops();
  await svc.fetchShuttles();
});