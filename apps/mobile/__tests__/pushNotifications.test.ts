jest.mock('../src/services/api/notifications', () => ({
  registerPushToken: jest.fn(),
  unregisterPushToken: jest.fn(),
}));

import messaging from '@react-native-firebase/messaging';
import { unregisterCurrentPushToken } from '../src/services/pushNotifications';
import { unregisterPushToken } from '../src/services/api/notifications';

const mockUnregister = unregisterPushToken as jest.Mock;
// The manual mock for @react-native-firebase/messaging exposes a singleton
// instance via messaging() — grab a typed handle to its mocked methods.
const mockGetToken = (messaging() as unknown as {
  getToken: jest.Mock;
}).getToken;

describe('unregisterCurrentPushToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockResolvedValue('mock-fcm-token');
  });

  it('forwards the device FCM token to the backend API', async () => {
    mockUnregister.mockResolvedValueOnce(undefined);

    await unregisterCurrentPushToken();

    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockUnregister).toHaveBeenCalledWith('mock-fcm-token');
  });

  it('no-ops when getToken returns an empty value', async () => {
    mockGetToken.mockResolvedValueOnce('');

    await unregisterCurrentPushToken();

    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it('swallows API errors so logout cannot fail because of push cleanup', async () => {
    mockUnregister.mockRejectedValueOnce(new Error('network down'));

    await expect(unregisterCurrentPushToken()).resolves.toBeUndefined();
  });

  it('swallows getToken errors', async () => {
    mockGetToken.mockRejectedValueOnce(new Error('FCM unavailable'));

    await expect(unregisterCurrentPushToken()).resolves.toBeUndefined();
    expect(mockUnregister).not.toHaveBeenCalled();
  });
});
