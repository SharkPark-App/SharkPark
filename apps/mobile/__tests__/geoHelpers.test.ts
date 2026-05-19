/**
 * Unit tests for geoHelpers
 *
 * Tests the pure geographic functions:
 *   haversineDistance, isAfterELotOpen, isOnCampus,
 *   getDeviceLocale, usesImperialUnits, usesFahrenheit,
 *   formatTemperature, formatDistance
 */

import * as RNLocalize from 'react-native-localize';
import { Platform, NativeModules } from 'react-native';
import {
  haversineDistance,
  isAfterELotOpen,
  isOnCampus,
  getDeviceLocale,
  usesImperialUnits,
  usesFahrenheit,
  formatTemperature,
  formatDistance,
} from '../src/utils/geoHelpers';

// Re-mock react-native-localize with jest.fn() shims so individual tests can
// flip return values via `.mockReturnValueOnce` / `.mockImplementation`. The
// global jest.setup.js mock returns frozen arrow functions which spyOn cannot
// rebind on an ESM namespace import.
jest.mock('react-native-localize', () => ({
  getLocales: jest.fn(() => [
    { countryCode: 'US', languageTag: 'en-US', languageCode: 'en', isRTL: false },
  ]),
  getTemperatureUnit: jest.fn(() => 'fahrenheit'),
  usesMetricSystem: jest.fn(() => false),
  getNumberFormatSettings: jest.fn(() => ({ decimalSeparator: '.', groupingSeparator: ',' })),
  getCalendar: jest.fn(() => 'gregorian'),
  getCountry: jest.fn(() => 'US'),
  getCurrencies: jest.fn(() => ['USD']),
  getTimeZone: jest.fn(() => 'America/Los_Angeles'),
  uses24HourClock: jest.fn(() => false),
  findBestLanguageTag: jest.fn(() => ({ languageTag: 'en-US', isRTL: false })),
  useLocalize: jest.fn(),
  openAppLanguageSettings: jest.fn(),
}));

const getLocalesMock = RNLocalize.getLocales as jest.Mock;
const usesMetricMock = RNLocalize.usesMetricSystem as jest.Mock;
const tempUnitMock = RNLocalize.getTemperatureUnit as jest.Mock;

beforeEach(() => {
  // Re-prime defaults so cross-suite leaks don't surprise us.
  getLocalesMock.mockReturnValue([
    { countryCode: 'US', languageTag: 'en-US', languageCode: 'en', isRTL: false },
  ]);
  usesMetricMock.mockReturnValue(false);
  tempUnitMock.mockReturnValue('fahrenheit');
});

// A position on CSULB campus
const ON_CAMPUS = { latitude: 33.7838, longitude: -118.1089 };
// A position far from campus
const OFF_CAMPUS = { latitude: 34.05, longitude: -118.25 }; // downtown LA

// ── Tests ────────────────────────────────────────────────────────────────────

describe('isAfterELotOpen', () => {
  // 2026-04-14 is a Tuesday (weekday)
  it('returns false before 5:30 PM on a weekday', () => {
    expect(isAfterELotOpen(new Date('2026-04-14T17:00:00'))).toBe(false);
    expect(isAfterELotOpen(new Date('2026-04-14T12:00:00'))).toBe(false);
  });

  it('returns true at exactly 5:30 PM on a weekday', () => {
    expect(isAfterELotOpen(new Date('2026-04-14T17:30:00'))).toBe(true);
  });

  it('returns true after 5:30 PM on a weekday', () => {
    expect(isAfterELotOpen(new Date('2026-04-14T18:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-14T23:59:00'))).toBe(true);
  });

  // 2026-04-18 is a Saturday, 2026-04-19 is a Sunday
  it('returns true on Saturday regardless of time', () => {
    expect(isAfterELotOpen(new Date('2026-04-18T08:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-18T12:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-18T17:00:00'))).toBe(true);
  });

  it('returns true on Sunday regardless of time', () => {
    expect(isAfterELotOpen(new Date('2026-04-19T08:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-19T12:00:00'))).toBe(true);
    expect(isAfterELotOpen(new Date('2026-04-19T17:00:00'))).toBe(true);
  });
});

describe('isOnCampus', () => {
  it('returns true for CSULB campus coordinates', () => {
    expect(isOnCampus(ON_CAMPUS.latitude, ON_CAMPUS.longitude)).toBe(true);
  });

  it('returns false for downtown LA', () => {
    expect(isOnCampus(OFF_CAMPUS.latitude, OFF_CAMPUS.longitude)).toBe(false);
  });
});

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistance(33.78, -118.11, 33.78, -118.11)).toBe(0);
  });

  it('returns a reasonable distance for nearby points', () => {
    // ~111 m per 0.001° latitude
    const d = haversineDistance(33.780, -118.110, 33.781, -118.110);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(130);
  });
});

// ── Locale-aware formatters ──────────────────────────────────────────────────

describe('getDeviceLocale', () => {
  afterEach(() => {
    getLocalesMock.mockReset();
    // Re-prime with the default snapshot from jest.setup.js so other tests
    // in this file keep their en-US baseline.
    getLocalesMock.mockReturnValue([
      { countryCode: 'US', languageTag: 'en-US', languageCode: 'en', isRTL: false },
    ]);
  });

  it('returns the first BCP-47 tag from RNLocalize.getLocales()', () => {
    getLocalesMock.mockReturnValue([
      { countryCode: 'FR', languageTag: 'fr-FR', languageCode: 'fr', isRTL: false },
      { countryCode: 'US', languageTag: 'en-US', languageCode: 'en', isRTL: false },
    ]);
    expect(getDeviceLocale()).toBe('fr-FR');
  });

  it('falls back to NativeModules.SettingsManager on iOS when RNLocalize is empty', () => {
    getLocalesMock.mockReturnValue([]);
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const originalSettings = NativeModules.SettingsManager;
    (NativeModules as Record<string, unknown>).SettingsManager = {
      settings: { AppleLocale: 'es-MX' },
    };

    try {
      expect(getDeviceLocale()).toBe('es-MX');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
      (NativeModules as Record<string, unknown>).SettingsManager = originalSettings;
    }
  });

  it('falls back to AppleLanguages[0] when AppleLocale missing on iOS', () => {
    getLocalesMock.mockReturnValue([]);
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const originalSettings = NativeModules.SettingsManager;
    (NativeModules as Record<string, unknown>).SettingsManager = {
      settings: { AppleLanguages: ['de-DE', 'en-US'] },
    };

    try {
      expect(getDeviceLocale()).toBe('de-DE');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
      (NativeModules as Record<string, unknown>).SettingsManager = originalSettings;
    }
  });

  it('falls back to I18nManager.localeIdentifier on Android when RNLocalize empty', () => {
    getLocalesMock.mockReturnValue([]);
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const originalI18n = NativeModules.I18nManager;
    (NativeModules as Record<string, unknown>).I18nManager = {
      localeIdentifier: 'ja_JP',
    };

    try {
      expect(getDeviceLocale()).toBe('ja_JP');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
      (NativeModules as Record<string, unknown>).I18nManager = originalI18n;
    }
  });

  it('returns "en-US" when both RNLocalize and native modules fail', () => {
    getLocalesMock.mockImplementation(() => { throw new Error('native bridge offline'); });
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const originalSettings = NativeModules.SettingsManager;
    (NativeModules as Record<string, unknown>).SettingsManager = undefined;

    try {
      expect(getDeviceLocale()).toBe('en-US');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
      (NativeModules as Record<string, unknown>).SettingsManager = originalSettings;
    }
  });
});

describe('usesImperialUnits', () => {
  afterEach(() => {
    usesMetricMock.mockReset();
    usesMetricMock.mockReturnValue(false); // default: en-US / imperial
  });

  it('returns true when RNLocalize reports the system is NOT metric', () => {
    usesMetricMock.mockReturnValue(false);
    expect(usesImperialUnits()).toBe(true);
  });

  it('returns false when RNLocalize reports the system IS metric (US user flipped iOS Measurement System to Metric)', () => {
    usesMetricMock.mockReturnValue(true);
    expect(usesImperialUnits()).toBe(false);
  });

  it('falls back to region inference (imperial) when RNLocalize throws', () => {
    usesMetricMock.mockImplementation(() => { throw new Error('native offline'); });
    expect(usesImperialUnits('en-US')).toBe(true);
    expect(usesImperialUnits('en-GB')).toBe(true);
    expect(usesImperialUnits('en_LR')).toBe(true);
  });

  it('falls back to region inference (metric) for non-imperial regions', () => {
    usesMetricMock.mockImplementation(() => { throw new Error('native offline'); });
    expect(usesImperialUnits('fr-FR')).toBe(false);
    expect(usesImperialUnits('de-DE')).toBe(false);
    expect(usesImperialUnits('ja-JP')).toBe(false);
  });

  it('handles locales without a region segment by defaulting to metric', () => {
    usesMetricMock.mockImplementation(() => { throw new Error('native offline'); });
    expect(usesImperialUnits('en')).toBe(false);
    expect(usesImperialUnits('')).toBe(false);
  });
});

describe('usesFahrenheit', () => {
  afterEach(() => {
    tempUnitMock.mockReset();
    tempUnitMock.mockReturnValue('fahrenheit');
  });

  it('returns true when RNLocalize reports "fahrenheit"', () => {
    tempUnitMock.mockReturnValue('fahrenheit');
    expect(usesFahrenheit()).toBe(true);
  });

  it('returns false when RNLocalize reports "celsius" (US user flipped iOS Temperature to Celsius)', () => {
    tempUnitMock.mockReturnValue('celsius');
    expect(usesFahrenheit()).toBe(false);
  });

  it('falls back to region inference when RNLocalize throws', () => {
    tempUnitMock.mockImplementation(() => { throw new Error('native offline'); });
    expect(usesFahrenheit('en-US')).toBe(true);
    expect(usesFahrenheit('en-PR')).toBe(true); // Puerto Rico — follows US
    // UK uses miles but Celsius — NOT in FAHRENHEIT_REGIONS
    expect(usesFahrenheit('en-GB')).toBe(false);
    expect(usesFahrenheit('fr-FR')).toBe(false);
  });

  it('returns false when locale has no region and native bridge is offline', () => {
    tempUnitMock.mockImplementation(() => { throw new Error('native offline'); });
    expect(usesFahrenheit('en')).toBe(false);
  });
});

describe('formatTemperature', () => {
  afterEach(() => {
    tempUnitMock.mockReset();
    tempUnitMock.mockReturnValue('fahrenheit');
  });

  it('renders °F in Fahrenheit locales', () => {
    tempUnitMock.mockReturnValue('fahrenheit');
    expect(formatTemperature(72)).toBe('72°F');
    expect(formatTemperature(32)).toBe('32°F');
  });

  it('converts F → C and rounds in Celsius locales', () => {
    tempUnitMock.mockReturnValue('celsius');
    expect(formatTemperature(32)).toBe('0°C');
    expect(formatTemperature(212)).toBe('100°C');
    expect(formatTemperature(72)).toBe('22°C'); // (72-32)*5/9 ≈ 22.22 → 22
  });

  it('omits the unit when withUnit:false (bare degree symbol)', () => {
    tempUnitMock.mockReturnValue('fahrenheit');
    expect(formatTemperature(72, { withUnit: false })).toBe('72°');
    tempUnitMock.mockReturnValue('celsius');
    expect(formatTemperature(32, { withUnit: false })).toBe('0°');
  });

  it('respects an explicit locale override regardless of native readout', () => {
    tempUnitMock.mockImplementation(() => { throw new Error('offline'); });
    expect(formatTemperature(50, { locale: 'fr-FR' })).toBe('10°C');
    expect(formatTemperature(50, { locale: 'en-US' })).toBe('50°F');
  });
});

describe('formatDistance', () => {
  afterEach(() => {
    usesMetricMock.mockReset();
    usesMetricMock.mockReturnValue(false);
  });

  describe('imperial', () => {
    beforeEach(() => usesMetricMock.mockReturnValue(false));

    it('renders short distances in feet rounded to the nearest 10', () => {
      // 45 m × 3.28084 ≈ 147.6 ft → round to 150
      expect(formatDistance(45)).toBe('150 ft');
      // 30 m × 3.28084 ≈ 98.4 ft → round to 100
      expect(formatDistance(30)).toBe('100 ft');
    });

    it('switches to miles at the 0.1-mi threshold (~160 m)', () => {
      expect(formatDistance(800)).toBe('0.5 mi');
      expect(formatDistance(5400)).toBe('3.4 mi');
    });

    it('renders 0 m as 0 ft', () => {
      expect(formatDistance(0)).toBe('0 ft');
    });
  });

  describe('metric', () => {
    beforeEach(() => usesMetricMock.mockReturnValue(true));

    it('renders short distances in metres rounded to the nearest 10', () => {
      expect(formatDistance(45)).toBe('50 m');
      expect(formatDistance(800)).toBe('800 m');
    });

    it('switches to km at 1000 m with one decimal', () => {
      expect(formatDistance(1000)).toBe('1.0 km');
      expect(formatDistance(5400)).toBe('5.4 km');
    });
  });

  it('respects explicit locale override even when native bridge throws', () => {
    usesMetricMock.mockImplementation(() => { throw new Error('offline'); });
    expect(formatDistance(1500, 'fr-FR')).toBe('1.5 km');
    expect(formatDistance(1500, 'en-US')).toBe('0.9 mi');
  });
});
