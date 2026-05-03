import { runCronJob } from './_bootstrap';
import { WeatherForecastFetchService } from '../weather/weather-forecast-fetch.service';

void runCronJob('fetch-weather-forecast', async ({ app }) => {
  const svc = app.get(WeatherForecastFetchService);
  await svc.fetchForecast();
});
