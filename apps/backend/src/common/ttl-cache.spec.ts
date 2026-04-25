import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    cache = new TtlCache<string>(1000); // 1 second TTL
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should store and retrieve values', () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  it('should return undefined for expired entries', () => {
    cache.set('key', 'value');
    jest.advanceTimersByTime(1001);
    expect(cache.get('key')).toBeUndefined();
  });

  it('should return value before TTL expires', () => {
    cache.set('key', 'value');
    jest.advanceTimersByTime(999);
    expect(cache.get('key')).toBe('value');
  });

  it('should clear all entries', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('should overwrite existing keys', () => {
    cache.set('key', 'old');
    cache.set('key', 'new');
    expect(cache.get('key')).toBe('new');
  });
});
