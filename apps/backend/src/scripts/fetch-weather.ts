import { runCronJob } from './_bootstrap';
import { WeatherFetchService } from '../weather/weather-fetch.service';

void runCronJob('fetch-weather', async ({ app }) => {
  const svc = app.get(WeatherFetchService);
  await svc.fetchWeather();
});
