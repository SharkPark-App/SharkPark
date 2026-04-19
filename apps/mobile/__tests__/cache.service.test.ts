/**
 * Cache Service Tests
 * Validates stale-while-revalidate caching, LRU eviction, and offline behavior.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheService } from '../src/services/api/cache';
import { NetInfo } from '../src/services/api/network';

// AsyncStorage is auto-mocked by @react-native-async-storage mock
jest.mock('../src/services/api/network');
const mockNetInfo = NetInfo as jest.Mocked<typeof NetInfo>;

const CACHE_PREFIX = '@sharkpark_cache:';
const CACHE_INDEX_KEY = '@sharkpark_cache_index';

describe('CacheService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockNetInfo.isConnected.mockResolvedValue(true);
  });

  describe('get / set', () => {
    it('should store and retrieve a value', async () => {
      await cacheService.set('test-key', { name: 'lot1' });
      const result = await cacheService.get<{ name: string }>('test-key');

      expect(result).not.toBeNull();
      expect(result!.data).toEqual({ name: 'lot1' });
      expect(result!.isStale).toBe(false);
    });

    it('should return null for missing keys', async () => {
      const result = await cacheService.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should mark expired entries as stale', async () => {
      // Store with a very short TTL
      await cacheService.set('expiring', 'data', { ttl: 1 });

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(() => resolve(undefined), 10));

      const result = await cacheService.get<string>('expiring');
      expect(result).not.toBeNull();
      expect(result!.isStale).toBe(true);
    });

    it('should return null for entries older than MAX_STALE_AGE', async () => {
      // Manually store a very old cache entry
      const entry = {
        data: 'old-data',
        cachedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        ttl: 60000,
      };
      await AsyncStorage.setItem(CACHE_PREFIX + 'old-key', JSON.stringify(entry));

      const result = await cacheService.get('old-key');
      expect(result).toBeNull();
    });

    it('should respect strictFreshness option', async () => {
      await cacheService.set('strict', 'data', { ttl: 1 });
      await new Promise(resolve => setTimeout(() => resolve(undefined), 10));

      const result = await cacheService.get('strict', { strictFreshness: true });
      expect(result).toBeNull();
    });
  });

  describe('remove / clear', () => {
    it('should remove a specific entry', async () => {
      await cacheService.set('to-remove', 'data');
      await cacheService.remove('to-remove');

      const result = await cacheService.get('to-remove');
      expect(result).toBeNull();
    });

    it('should clear all cache entries', async () => {
      await cacheService.set('a', 1);
      await cacheService.set('b', 2);
      await cacheService.clear();

      expect(await cacheService.get('a')).toBeNull();
      expect(await cacheService.get('b')).toBeNull();
    });
  });

  describe('getOrFetch', () => {
    it('should call fetcher and cache the result on first call', async () => {
      const fetcher = jest.fn().mockResolvedValue({ lots: [1, 2, 3] });

      const result = await cacheService.getOrFetch('lots:all', fetcher, { ttl: 60000 });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual({ lots: [1, 2, 3] });
      expect(result.source).toBe('network');
      expect(result.isStale).toBe(false);

      // Verify it was persisted
      const cached = await cacheService.get('lots:all');
      expect(cached!.data).toEqual({ lots: [1, 2, 3] });
    });

    it('should return fresh cached data without calling fetcher', async () => {
      await cacheService.set('lots:fresh', 'cached-value', { ttl: 60000 });
      const fetcher = jest.fn();

      const result = await cacheService.getOrFetch('lots:fresh', fetcher, { ttl: 60000 });

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.data).toBe('cached-value');
      expect(result.source).toBe('cache');
      expect(result.isStale).toBe(false);
    });

    it('should revalidate stale cache and return fresh data', async () => {
      // Store with expired TTL — getOrFetch also uses ttl: 1 so get() sees it as stale
      await cacheService.set('lots:stale', 'old-value', { ttl: 1 });
      await new Promise(resolve => setTimeout(() => resolve(undefined), 10));

      const fetcher = jest.fn().mockResolvedValue('new-value');

      const result = await cacheService.getOrFetch('lots:stale', fetcher, { ttl: 1 });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.data).toBe('new-value');
      expect(result.source).toBe('network');
    });

    it('should serve stale cache when fetcher fails', async () => {
      await cacheService.set('lots:fallback', 'stale-data', { ttl: 1 });
      await new Promise(resolve => setTimeout(() => resolve(undefined), 10));

      const fetcher = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await cacheService.getOrFetch('lots:fallback', fetcher, { ttl: 1 });

      expect(result.data).toBe('stale-data');
      expect(result.source).toBe('cache');
      expect(result.isStale).toBe(true);
    });

    it('should serve stale cache when offline', async () => {
      await cacheService.set('lots:offline', 'cached', { ttl: 1 });
      await new Promise(resolve => setTimeout(() => resolve(undefined), 10));

      mockNetInfo.isConnected.mockResolvedValue(false);
      const fetcher = jest.fn();

      const result = await cacheService.getOrFetch('lots:offline', fetcher, { ttl: 1 });

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.data).toBe('cached');
      expect(result.isStale).toBe(true);
    });

    it('should throw when offline with no cache', async () => {
      mockNetInfo.isConnected.mockResolvedValue(false);
      const fetcher = jest.fn();

      await expect(
        cacheService.getOrFetch('lots:missing', fetcher),
      ).rejects.toThrow('No cached data available');
    });

    it('should throw when online, fetcher fails, and no stale cache', async () => {
      const fetcher = jest.fn().mockRejectedValue(new Error('Server error'));

      await expect(
        cacheService.getOrFetch('lots:none', fetcher),
      ).rejects.toThrow('Server error');
    });
  });

  describe('LRU eviction', () => {
    it('should maintain a cache index', async () => {
      await cacheService.set('key1', 'val1');
      await cacheService.set('key2', 'val2');

      const rawIndex = await AsyncStorage.getItem(CACHE_INDEX_KEY);
      const index = JSON.parse(rawIndex!);

      expect(index).toContain('key1');
      expect(index).toContain('key2');
    });
  });
});
