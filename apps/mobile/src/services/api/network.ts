/**
 * Network connectivity utilities
 * Wraps @react-native-community/netinfo for simple connectivity checks.
 */
import RNNetInfo from '@react-native-community/netinfo';

export const NetInfo = {
  /**
   * Check if the device is currently connected to the internet.
   * Returns true if connected, false otherwise.
   */
  async isConnected(): Promise<boolean> {
    try {
      const state = await RNNetInfo.fetch();
      return state.isConnected ?? false;
    } catch {
      // If we can't determine connectivity, assume connected
      return true;
    }
  },
};

export default NetInfo;
