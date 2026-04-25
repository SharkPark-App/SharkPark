import { runCronJob } from './_bootstrap';
import { OccupancyEventsService } from '../occupancy-events/occupancy-events.service';

const STALE_AGE_HOURS = 18;

void runCronJob('cleanup-device-states', async ({ app, logger }) => {
  const svc = app.get(OccupancyEventsService);
  const result = await svc.cleanupStaleDeviceStates(STALE_AGE_HOURS);
  logger.log(
    `[cron:cleanup-device-states] cleaned ${result.cleaned} stale ENTER records (>${STALE_AGE_HOURS}h)`,
  );
});
