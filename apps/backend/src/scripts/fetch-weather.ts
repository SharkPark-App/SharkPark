import { runCronJob } from './_bootstrap';
import { WeatherModule } from '../weather/weather.module';
import { WeatherFetchService } from '../weather/weather-fetch.service';

void runCronJob('fetch-weather', [WeatherModule], async ({ app }) => {
  const svc = app.get(WeatherFetchService);
  await svc.fetchWeather();
});
