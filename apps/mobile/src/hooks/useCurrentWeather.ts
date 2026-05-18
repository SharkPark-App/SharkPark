import { useState, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { weatherApi, type CurrentWeather } from '../services/api/weather';

interface UseCurrentWeatherReturn {
  weather: CurrentWeather | null;
  loading: boolean;
  error: string | null;
}

/**
 * Backend persists a fresh observation hourly via the `weather-fetch` cron.
 * Polling every 10 minutes gives us a one-tick worst-case freshness without
 * generating meaningful load. The hook also re-fetches when the app returns
 * to the foreground so a user who left the app open overnight doesn't see
 * a stale value the next morning.
 */
const WEATHER_POLL_MS = 10 * 60_000;

/** Returns the most recent campus weather observation. */
export function useCurrentWeather(): UseCurrentWeatherReturn {
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Monotonic generation counter — a slow in-flight fetch must never commit
  // on top of a newer one (mirrors the pattern used in useEvents).
  const genRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const fetchWeather = async () => {
      const myGen = ++genRef.current;
      try {
        const data = await weatherApi.getCurrent();
        if (cancelled || genRef.current !== myGen) return;
        setWeather(data);
        setError(null);
      } catch (err) {
        if (cancelled || genRef.current !== myGen) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch weather');
      } finally {
        if (!cancelled && genRef.current === myGen) setLoading(false);
      }
    };

    fetchWeather();
    const id = setInterval(fetchWeather, WEATHER_POLL_MS);

    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') fetchWeather();
    });

    return () => {
      cancelled = true;
      clearInterval(id);
      sub.remove();
    };
  }, []);

  return { weather, loading, error };
}
