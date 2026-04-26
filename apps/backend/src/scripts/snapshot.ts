import { runCronJob } from './_bootstrap';
import { OccupancyEventsService } from '../occupancy-events/occupancy-events.service';

void runCronJob('snapshot', async ({ app, logger }) => {
  const svc = app.get(OccupancyEventsService);
  const result = await svc.createSnapshots();
  logger.log(
    `[cron:snapshot] created ${result.count} occupancy snapshots at ${result.timestamp}`,
  );
});
