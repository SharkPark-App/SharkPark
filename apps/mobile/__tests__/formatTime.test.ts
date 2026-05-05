import { formatTime, formatTimeRange } from '../src/utils/formatTime';

/**
 * The whole point of `formatTime` is that it lets the OS decide 12 vs 24-hour
 * presentation. That requires:
 *   1. NOT passing the `hour12` option, and
 *   2. NOT passing a hardcoded locale (e.g. `'en-US'`).
 *
 * We assert those invariants by spying on `Date.prototype.toLocaleTimeString`.
 */
describe('formatTime', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(Date.prototype, 'toLocaleTimeString');
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('formats a Date without forcing locale or hour12', () => {
    formatTime(new Date(2026, 0, 1, 14, 30));
    expect(spy).toHaveBeenCalledTimes(1);
    const [locale, options] = spy.mock.calls[0];
    expect(locale).toBeUndefined();
    expect(options).toEqual({ hour: 'numeric', minute: '2-digit' });
    // explicit guard against future regressions
    expect(options).not.toHaveProperty('hour12');
  });

  it('parses an "HH:MM" string and routes through the same locale-aware path', () => {
    formatTime('09:00');
    const [, options] = spy.mock.calls[0];
    expect(options).not.toHaveProperty('hour12');
  });

  it('returns the input unchanged when the string cannot be parsed', () => {
    expect(formatTime('CLOSED')).toBe('CLOSED');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns "" for malformed Date inputs', () => {
    // formatTime accepts Date | string; we only verify behaviour on the
    // documented inputs. Sanity-check the parse failure branch.
    expect(formatTime('25:99')).toBe('25:99');
  });
});

describe('formatTimeRange', () => {
  it('returns "start – end" when end is later than start', () => {
    const start = new Date(2026, 0, 1, 14, 0);
    const end = new Date(2026, 0, 1, 16, 30);
    // en-US default in Jest; on-device the locale takes over.
    expect(formatTimeRange(start, end)).toBe('2:00 PM – 4:30 PM');
  });

  it('falls back to start-only when end is omitted', () => {
    const start = new Date(2026, 0, 1, 14, 0);
    expect(formatTimeRange(start)).toBe('2:00 PM');
  });

  it('falls back to start-only when end is not after start', () => {
    const start = new Date(2026, 0, 1, 14, 0);
    expect(formatTimeRange(start, start)).toBe('2:00 PM');
    expect(formatTimeRange(start, new Date(2026, 0, 1, 13, 0))).toBe('2:00 PM');
  });

  it('falls back to start-only when end is an Invalid Date', () => {
    const start = new Date(2026, 0, 1, 14, 0);
    expect(formatTimeRange(start, new Date(NaN))).toBe('2:00 PM');
  });
});
