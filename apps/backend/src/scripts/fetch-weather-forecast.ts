import { runCronJob } from './_bootstrap';
import { WeatherModule } from '../weather/weather.module';
import { WeatherForecastFetchService } from '../weather/weather-forecast-fetch.service';

void runCronJob('fetch-weather-forecast', [WeatherModule], async ({ app }) => {
  const svc = app.get(WeatherForecastFetchService);
  await svc.fetchForecast();
});
