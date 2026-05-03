import { runCronJob } from './_bootstrap';
import { ShuttleTrackerService } from '../shuttle-tracker/shuttle-tracker.service';

void runCronJob('fetch-transit', async ({ app }) => {
  const svc = app.get(ShuttleTrackerService);
  await svc.fetchRoutesAndStops();
  await svc.fetchShuttles();
});