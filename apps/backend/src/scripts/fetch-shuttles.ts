import { runCronJob } from './_bootstrap';
import { RedisModule } from '../redis/redis.module';
import { ShuttleTrackerCoreModule } from '../shuttle-tracker/shuttle-tracker-core.module';
import { ShuttleTrackerService } from '../shuttle-tracker/shuttle-tracker.service';

void runCronJob(
  'fetch-shuttles',
  [RedisModule, ShuttleTrackerCoreModule],
  async ({ app }) => {
    const svc = app.get(ShuttleTrackerService);
    await svc.fetchShuttles();
  },
);
