/**
 * Network Service Tests
 * Validates network connectivity wrapper.
 */
import RNNetInfo from '@react-native-community/netinfo';
import { NetInfo } from '../src/services/api/network';

jest.mock('@react-native-community/netinfo');
const mockRNNetInfo = RNNetInfo as jest.Mocked<typeof RNNetInfo>;

describe('NetInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isConnected', () => {
    it('should return true when connected', async () => {
      mockRNNetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      } as never);

      const result = await NetInfo.isConnected();
      expect(result).toBe(true);
    });

    it('should return false when disconnected', async () => {
      mockRNNetInfo.fetch.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      } as never);

      const result = await NetInfo.isConnected();
      expect(result).toBe(false);
    });

    it('should return false when isConnected is null', async () => {
      mockRNNetInfo.fetch.mockResolvedValue({
        isConnected: null,
        isInternetReachable: null,
        type: 'unknown',
        details: null,
      } as never);

      const result = await NetInfo.isConnected();
      expect(result).toBe(false);
    });

    it('should assume connected when fetch throws', async () => {
      mockRNNetInfo.fetch.mockRejectedValue(new Error('Native module error'));

      const result = await NetInfo.isConnected();
      expect(result).toBe(true);
    });
  });
});
