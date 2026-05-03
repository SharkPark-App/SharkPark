import {
  computeFeelsLikeF,
  deriveIsRaining,
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
