import { ConfigService } from '@nestjs/config';
import {
  computeFeelsLikeF,
  deriveIsRaining,
  NwsClient,
  parseWindSpeedMph,
  probabilityToRate,
  NwsHourlyPeriod,
} from './nws.client';

describe('NWS client helpers', () => {
  describe('parseWindSpeedMph', () => {
    it('parses single-value strings', () => {
      expect(parseWindSpeedMph('5 mph')).toBe(5);
    });
    it('uses the upper bound of a range', () => {
      expect(parseWindSpeedMph('5 to 10 mph')).toBe(10);
    });
    it('returns 0 when no number is present', () => {
      expect(parseWindSpeedMph('calm')).toBe(0);
    });
  });

  describe('probabilityToRate', () => {
    it('converts 0-100 percent to 0-1 rate', () => {
      expect(
        probabilityToRate({ unitCode: 'wmoUnit:percent', value: 75 }),
      ).toBeCloseTo(0.75);
    });
    it('treats null value as 0', () => {
      expect(
        probabilityToRate({ unitCode: 'wmoUnit:percent', value: null }),
      ).toBe(0);
    });
    it('treats null payload as 0', () => {
      expect(probabilityToRate(null)).toBe(0);
    });
    it('clamps out-of-range values', () => {
      expect(
        probabilityToRate({ unitCode: 'wmoUnit:percent', value: 150 }),
      ).toBe(1);
    });
  });

  describe('deriveIsRaining', () => {
    const period = (
      shortForecast: string,
      pop: number | null,
    ): NwsHourlyPeriod => ({
      startTime: '',
      endTime: '',
      temperature: 70,
      temperatureUnit: 'F',
      probabilityOfPrecipitation:
        pop == null
          ? null
          : { unitCode: 'wmoUnit:percent', value: pop },
      shortForecast,
      windSpeed: '5 mph',
      isDaytime: true,
    });

    it('is true for "Rain Likely" at 70%', () => {
      expect(deriveIsRaining(period('Rain Likely', 70))).toBe(true);
    });
    it('is false for "Slight Chance Showers" at 20%', () => {
      expect(deriveIsRaining(period('Slight Chance Showers', 20))).toBe(false);
    });
    it('is false for "Sunny" regardless of pop', () => {
      expect(deriveIsRaining(period('Sunny', 90))).toBe(false);
    });
    it('matches thunderstorm and drizzle', () => {
      expect(deriveIsRaining(period('Scattered Thunderstorms', 60))).toBe(true);
      expect(deriveIsRaining(period('Light Drizzle', 50))).toBe(true);
    });
  });

  describe('computeFeelsLikeF', () => {
    it('returns dry-bulb when in neither heat-index nor wind-chill range', () => {
      expect(computeFeelsLikeF(70, 50, 5)).toBe(70);
    });
    it('computes a heat index above 80°F with humidity > 40%', () => {
      const fl = computeFeelsLikeF(95, 70, 5);
      expect(fl).toBeGreaterThan(95);
    });
    it('computes a wind chill below 50°F with wind > 3 mph', () => {
      const fl = computeFeelsLikeF(40, 50, 15);
      expect(fl).toBeLessThan(40);
    });
    it('returns dry-bulb when humidity is null in heat-index range', () => {
      expect(computeFeelsLikeF(95, null, 5)).toBe(95);
    });
  });
});

describe('NwsClient', () => {
  const ua = 'Test/1.0 (test@example.com)';
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'weather.userAgent' ? ua : fallback,
    ),
  } as unknown as ConfigService;

  const pointsResponse = {
    properties: {
      gridId: 'LOX',
      gridX: 153,
      gridY: 44,
      forecastHourly:
        'https://api.weather.gov/gridpoints/LOX/153,44/forecast/hourly',
    },
  };
  const hourlyResponse = {
    properties: {
      updateTime: '2026-05-03T18:00:00Z',
      periods: [
        {
          startTime: '2026-05-03T12:00:00-07:00',
          endTime: '2026-05-03T13:00:00-07:00',
          temperature: 72,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 20 },
          shortForecast: 'Sunny',
          windSpeed: '5 mph',
          isDaytime: true,
        },
      ],
    },
  };

  const mockFetch = (
    body: unknown,
    { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
  ) =>
    jest.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
    });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the configured User-Agent and Accept header on each request', async () => {
    const fetchMock = mockFetch(pointsResponse);
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    const client = new NwsClient(config);
    await client.getPoint(33.7838, -118.1134);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.weather.gov/points/33.7838,-118.1134',
      {
        headers: {
          'User-Agent': ua,
          Accept: 'application/geo+json',
        },
      },
    );
  });

  it('caches getPoint results across calls within the TTL window', async () => {
    const fetchMock = mockFetch(pointsResponse);
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    const client = new NwsClient(config);

    const a = await client.getPoint(33.7838, -118.1134);
    const b = await client.getPoint(33.7838, -118.1134);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.gridId).toBe('LOX');
    expect(a.gridX).toBe(153);
    expect(a.gridY).toBe(44);
  });

  it('_resetCache forces a re-fetch of the point', async () => {
    const fetchMock = mockFetch(pointsResponse);
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    const client = new NwsClient(config);

    await client.getPoint(33.7838, -118.1134);
    client._resetCache();
    await client.getPoint(33.7838, -118.1134);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getHourlyForecast chains the cached point + hourly fetch', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => pointsResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => hourlyResponse });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    const client = new NwsClient(config);
    const result = await client.getHourlyForecast(33.7838, -118.1134);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      pointsResponse.properties.forecastHourly,
      expect.any(Object),
    );
    expect(result.updateTime).toBe(hourlyResponse.properties.updateTime);
    expect(result.periods).toHaveLength(1);
  });

  it('throws on non-2xx responses with the URL and status in the message', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch(
      {},
      { ok: false, status: 503 },
    );

    const client = new NwsClient(config);
    await expect(client.getPoint(33.7838, -118.1134)).rejects.toThrow(
      /points\/33\.7838,-118\.1134.*HTTP 503/,
    );
  });

  it('falls back to the default UA when no override is configured', () => {
    const noOverride = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    } as unknown as ConfigService;

    new NwsClient(noOverride);
    expect(noOverride.get).toHaveBeenCalledWith(
      'weather.userAgent',
      'SharkPark/1.0 (ops@sharkpark.app)',
    );
  });
});
