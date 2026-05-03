import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin client for the US National Weather Service public API
 * (https://api.weather.gov). Free, no key, requires a descriptive
 * `User-Agent` header per the NWS terms.
 *
 * Two endpoints we use:
 *   - GET /points/{lat},{lon}             →  metadata; tells us which forecast
 *                                            office + gridpoint covers our
 *                                            campus. Result is stable for
 *                                            years; cached for 24h.
 *   - GET /gridpoints/{office}/{x},{y}/forecast/hourly
 *                                         →  ~156 hourly periods with
 *                                            temperature, probabilityOfPrecipitation,
 *                                            shortForecast, windSpeed, etc.
 *
 * Why not also call /stations/.../observations/latest? See
 * `apps/backend/src/weather/README` (or the migration PR description): the
 * hourly-forecast `periods[0]` slice gives us every field we store in `Weather`
 * including a real precipitation probability, from a single endpoint, with a
 * single failure domain. Switching to NWS station observations would
 * re-introduce a second vendor surface and a missing `pop` field — the exact
 * bug we just fixed.
 */

export interface NwsHourlyPeriod {
  /** ISO timestamp marking the start of the period (1 hour long). */
  startTime: string;
  /** ISO timestamp marking the end of the period. */
  endTime: string;
  /** Temperature value, with unit per `temperatureUnit` (always 'F' for US grids). */
  temperature: number;
  temperatureUnit: 'F' | 'C';
  /**
   * NWS returns either `null` or an object `{ unitCode, value }` where value
   * is in percent (0-100). May be `null` for periods more than 7 days out.
   */
  probabilityOfPrecipitation: { unitCode: string; value: number | null } | null;
  /** Plain-English summary like "Sunny", "Light Rain Likely", "Mostly Cloudy". */
  shortForecast: string;
  /** Like "5 mph" or "5 to 10 mph". Parsed loosely. */
  windSpeed: string;
  /** Optional: relativeHumidity payload. */
  relativeHumidity?: { unitCode: string; value: number | null };
  /** Optional: dewpoint payload. */
  dewpoint?: { unitCode: string; value: number | null };
  isDaytime: boolean;
}

interface NwsPointsResponse {
  properties: {
    gridId: string;
    gridX: number;
    gridY: number;
    forecastHourly: string;
  };
}

interface NwsHourlyForecastResponse {
  properties: {
    updateTime: string;
    periods: NwsHourlyPeriod[];
  };
}

interface CachedPoint {
  gridId: string;
  gridX: number;
  gridY: number;
  forecastHourlyUrl: string;
  cachedAt: number;
}

const POINT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

@Injectable()
export class NwsClient {
  private readonly logger = new Logger(NwsClient.name);
  private readonly userAgent: string;
  private readonly baseUrl = 'https://api.weather.gov';
  /** Keyed by `${lat},${lon}` rounded to 4 decimals (NWS rounds anyway). */
  private readonly pointCache = new Map<string, CachedPoint>();

  constructor(private readonly config: ConfigService) {
    // NWS asks for a descriptive UA so they can contact heavy users.
    // Falls back to a sensible default if the env var is unset, but production
    // should always set WEATHER_USER_AGENT.
    this.userAgent = this.config.get<string>(
      'weather.userAgent',
      'SharkPark/1.0 (ops@sharkpark.app)',
    );
  }

  /**
   * Resolve a (lat, lon) to a forecast office + grid coordinate. NWS itself
   * recommends caching this aggressively because gridpoints rarely change.
   */
  async getPoint(
    lat: number,
    lon: number,
  ): Promise<{
    gridId: string;
    gridX: number;
    gridY: number;
    forecastHourlyUrl: string;
  }> {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = this.pointCache.get(key);
    if (cached && Date.now() - cached.cachedAt < POINT_CACHE_TTL_MS) {
      return cached;
    }

    const url = `${this.baseUrl}/points/${key}`;
    const data = await this.fetchJson<NwsPointsResponse>(url);
    const entry: CachedPoint = {
      gridId: data.properties.gridId,
      gridX: data.properties.gridX,
      gridY: data.properties.gridY,
      forecastHourlyUrl: data.properties.forecastHourly,
      cachedAt: Date.now(),
    };
    this.pointCache.set(key, entry);
    this.logger.log(
      `Resolved (${key}) → ${entry.gridId}/${entry.gridX},${entry.gridY}`,
    );
    return entry;
  }

  /**
   * Fetch the full hourly forecast (~156 periods, ~6.5 days) for the
   * gridpoint covering the supplied coordinate.
   */
  async getHourlyForecast(
    lat: number,
    lon: number,
  ): Promise<{ updateTime: string; periods: NwsHourlyPeriod[] }> {
    const point = await this.getPoint(lat, lon);
    const data = await this.fetchJson<NwsHourlyForecastResponse>(
      point.forecastHourlyUrl,
    );
    return {
      updateTime: data.properties.updateTime,
      periods: data.properties.periods,
    };
  }

  /**
   * Clear the point cache. Test seam — production code should never need this.
   */
  resetCache(): void {
    this.pointCache.clear();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'application/geo+json',
      },
    });

    if (!response.ok) {
      throw new Error(`NWS request to ${url} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
//
// Exported as plain functions (not class methods) so they're trivially
// unit-testable without booting the Nest module.

/** Parse "5 mph" or "5 to 10 mph" → numeric mph (uses the upper bound). */
export function parseWindSpeedMph(raw: string): number {
  const matches = raw.match(/(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return 0;
  // Take the last number — handles both "5 mph" and "5 to 10 mph".
  return parseFloat(matches[matches.length - 1]);
}

/**
 * NWS `probabilityOfPrecipitation.value` is an integer percent (0-100), and
 * may be `null` for far-future periods. Our schema stores it as a 0-1 rate
 * to match `weather.service.ts` thresholds and the ML feature contract.
 */
export function probabilityToRate(
  pop: NwsHourlyPeriod['probabilityOfPrecipitation'],
): number {
  const value = pop?.value;
  if (value == null) return 0;
  return Math.max(0, Math.min(1, value / 100));
}

const _RAIN_KEYWORDS = ['rain', 'shower', 'drizzle', 'thunderstorm'];

/**
 * Derive `is_raining` from a forecast period. We treat the period as "rainy"
 * if its short-forecast text mentions a rain keyword AND the precipitation
 * probability is >= 50%. Pure keyword matching false-positives on "Slight
 * Chance Rain Showers" at 15% pop, which would over-count rain in the ML
 * weather adjustment. Pop-only would miss snow/thunderstorm periods.
 */
export function deriveIsRaining(period: NwsHourlyPeriod): boolean {
  const text = (period.shortForecast ?? '').toLowerCase();
  const hasRainWord = _RAIN_KEYWORDS.some((kw) => text.includes(kw));
  if (!hasRainWord) return false;
  const popRate = probabilityToRate(period.probabilityOfPrecipitation);
  return popRate >= 0.5;
}

/**
 * Compute "feels like" temperature. NWS hourly does not return apparent
 * temperature directly, so we approximate from temp + humidity + wind. Heat
 * Index applies above ~80°F with humidity > 40%; Wind Chill below ~50°F with
 * wind > 3 mph; otherwise feels-like equals the dry-bulb temperature.
 *
 * Formulas: NWS standard heat-index polynomial (Rothfusz) and wind-chill
 * formula (Osczevski/Bluestein). Approximate is fine — `feels_like_f` only
 * affects display copy and is not consumed by the ML model.
 */
export function computeFeelsLikeF(
  tempF: number,
  humidityPct: number | null | undefined,
  windMph: number,
): number {
  if (tempF >= 80 && humidityPct != null && humidityPct > 40) {
    const T = tempF;
    const R = humidityPct;
    const hi =
      -42.379 +
      2.04901523 * T +
      10.14333127 * R -
      0.22475541 * T * R -
      0.00683783 * T * T -
      0.05481717 * R * R +
      0.00122874 * T * T * R +
      0.00085282 * T * R * R -
      0.00000199 * T * T * R * R;
    return Math.round(hi * 10) / 10;
  }
  if (tempF <= 50 && windMph > 3) {
    const wc =
      35.74 +
      0.6215 * tempF -
      35.75 * Math.pow(windMph, 0.16) +
      0.4275 * tempF * Math.pow(windMph, 0.16);
    return Math.round(wc * 10) / 10;
  }
  return tempF;
}
