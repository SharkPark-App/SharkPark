import { runCronJob } from './_bootstrap';
import { OccupancyEventsModule } from '../occupancy-events/occupancy-events.module';
import { OccupancyEventsService } from '../occupancy-events/occupancy-events.service';

void runCronJob('snapshot', [OccupancyEventsModule], async ({ app, logger }) => {
  const svc = app.get(OccupancyEventsService);
  const result = await svc.createSnapshots();
  logger.log(
    `[cron:snapshot] created ${result.count} occupancy snapshots at ${result.timestamp}`,
  );
});
