import { runCronJob } from './_bootstrap';
import { ShuttleTrackerService } from '../shuttle-tracker/shuttle-tracker.service';

void runCronJob('snapshot', async ({ app }) => {
  const svc = app.get(ShuttleTrackerService);
  await svc.fetchRoutesAndStops();
});