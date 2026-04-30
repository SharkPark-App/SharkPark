import { runCronJob } from './_bootstrap';
import { ShuttleTrackerService } from '../shuttle-tracker/shuttle-tracker.service';

void runCronJob('fetch-routes-stops-shuttles', async ({ app }) => {
  const svc = app.get(ShuttleTrackerService);
  await svc.fetchRoutesAndStops();
  await svc.fetchShuttles();
});