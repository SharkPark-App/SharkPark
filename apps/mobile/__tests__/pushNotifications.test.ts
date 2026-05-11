jest.mock('../src/services/api/notifications', () => ({
  registerPushToken: jest.fn(),
  unregisterPushToken: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging from '@react-native-firebase/messaging';
import {
  initPushNotifications,
  subscribeForegroundMessages,
  simulateForegroundPushMessage,
  getInitialNotification,
  subscribeNotificationOpenedApp,
  unregisterCurrentPushToken,
} from '../src/services/pushNotifications';
import {
  registerPushToken,
  unregisterPushToken,
} from '../src/services/api/notifications';

const mockUnregister = unregisterPushToken as jest.Mock;
const mockRegister = registerPushToken as jest.Mock;
const mockGetItem = AsyncStorage.getItem as jest.Mock;
// The manual mock for @react-native-firebase/messaging exposes a singleton
// instance via messaging() — grab a typed handle to its mocked methods.
const mockMessaging = messaging() as unknown as {
  getToken: jest.Mock;
  hasPermission: jest.Mock;
  requestPermission: jest.Mock;
  registerDeviceForRemoteMessages: jest.Mock;
  onTokenRefresh: jest.Mock;
  onMessage: jest.Mock;
  onNotificationOpenedApp: jest.Mock;
  getInitialNotification: jest.Mock;
};
const mockGetToken = mockMessaging.getToken;
const mockHasPermission = mockMessaging.hasPermission;
const mockRequestPermission = mockMessaging.requestPermission;
const mockRegisterDeviceForRemoteMessages = mockMessaging.registerDeviceForRemoteMessages;
const mockOnTokenRefresh = mockMessaging.onTokenRefresh;
const mockOnMessage = mockMessaging.onMessage;
const mockOnNotificationOpenedApp = mockMessaging.onNotificationOpenedApp;
const mockGetInitialNotification = mockMessaging.getInitialNotification;
const AS = messaging.AuthorizationStatus;

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

describe('initPushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockResolvedValue('mock-fcm-token');
    mockRegister.mockResolvedValue(undefined);
    mockOnTokenRefresh.mockReturnValue(jest.fn());
    mockOnMessage.mockReturnValue(jest.fn());
    mockOnNotificationOpenedApp.mockReturnValue(jest.fn());
    mockGetInitialNotification.mockResolvedValue(null);
  });

  it('skips OS prompt and registers token when permission is already granted', async () => {
    mockHasPermission.mockResolvedValueOnce(AS.AUTHORIZED);

    await initPushNotifications();

    expect(mockHasPermission).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockRegisterDeviceForRemoteMessages).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith('mock-fcm-token', expect.any(String));
  });

  it('does NOT prompt when permission is denied AND the onboarding gate has already been shown', async () => {
    mockHasPermission.mockResolvedValueOnce(AS.DENIED);
    mockGetItem.mockResolvedValueOnce('true'); // @SharkPark:permissionGateShown

    await initPushNotifications();

    expect(mockGetItem).toHaveBeenCalledWith('@SharkPark:permissionGateShown');
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('falls back to prompting when the gate has never been shown (returning user)', async () => {
    mockHasPermission.mockResolvedValueOnce(AS.NOT_DETERMINED);
    mockGetItem.mockResolvedValueOnce(null);
    mockRequestPermission.mockResolvedValueOnce(AS.AUTHORIZED);

    await initPushNotifications();

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith('mock-fcm-token', expect.any(String));
  });

  it('returns a no-op cleanup when the prompted user denies', async () => {
    mockHasPermission.mockResolvedValueOnce(AS.NOT_DETERMINED);
    mockGetItem.mockResolvedValueOnce(null);
    mockRequestPermission.mockResolvedValueOnce(AS.DENIED);

    const unsub = await initPushNotifications();

    expect(mockRegister).not.toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('treats AsyncStorage read failure as "gate not shown" and prompts', async () => {
    mockHasPermission.mockResolvedValueOnce(AS.DENIED);
    mockGetItem.mockRejectedValueOnce(new Error('storage down'));
    mockRequestPermission.mockResolvedValueOnce(AS.AUTHORIZED);

    await initPushNotifications();

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('returns refresh unsubscribe and re-registers on token refresh', async () => {
    mockHasPermission.mockResolvedValueOnce(AS.AUTHORIZED);
    const unsubscribeRefresh = jest.fn();
    mockOnTokenRefresh.mockReturnValueOnce(unsubscribeRefresh);

    const cleanup = await initPushNotifications();

    expect(typeof cleanup).toBe('function');
    expect(mockOnTokenRefresh).toHaveBeenCalledTimes(1);

    const refreshHandler = mockOnTokenRefresh.mock.calls[0][0] as (token: string) => Promise<void>;
    await refreshHandler('new-fcm-token');

    expect(mockRegister).toHaveBeenLastCalledWith('new-fcm-token', expect.any(String));

    cleanup();
    expect(unsubscribeRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not register with backend when FCM returns an empty token', async () => {
    mockHasPermission.mockResolvedValueOnce(AS.AUTHORIZED);
    mockGetToken.mockResolvedValueOnce('');

    await initPushNotifications();

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockOnTokenRefresh).toHaveBeenCalledTimes(1);
  });

  it('swallows init errors and returns a safe no-op cleanup', async () => {
    mockHasPermission.mockRejectedValueOnce(new Error('permission read failed'));

    const cleanup = await initPushNotifications();

    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });
});

describe('push notification helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnMessage.mockReturnValue(jest.fn());
    mockOnNotificationOpenedApp.mockReturnValue(jest.fn());
    mockGetInitialNotification.mockResolvedValue({
      messageId: 'm1',
      data: { lotId: 'G1' },
    });
  });

  it('subscribes and unsubscribes foreground message handler', () => {
    const unsubscribeFirebase = jest.fn();
    mockOnMessage.mockReturnValueOnce(unsubscribeFirebase);
    const handler = jest.fn();

    const unsubscribe = subscribeForegroundMessages(handler);

    expect(mockOnMessage).toHaveBeenCalledWith(handler);
    unsubscribe();
    expect(unsubscribeFirebase).toHaveBeenCalledTimes(1);
  });

  it('simulates a foreground push message in development', () => {
    const handler = jest.fn();
    const unsubscribeFirebase = jest.fn();
    mockOnMessage.mockReturnValueOnce(unsubscribeFirebase);
    const unsubscribe = subscribeForegroundMessages(handler);

    simulateForegroundPushMessage({
      title: 'Lot Filling',
      body: 'G1 is getting busy',
      data: { lotId: 'G1' },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({ title: 'Lot Filling', body: 'G1 is getting busy' }),
        data: { lotId: 'G1' },
      }),
    );

    unsubscribe();
  });

  it('delegates initial notification retrieval to Firebase messaging', async () => {
    await expect(getInitialNotification()).resolves.toEqual({
      messageId: 'm1',
      data: { lotId: 'G1' },
    });
    expect(mockGetInitialNotification).toHaveBeenCalledTimes(1);
  });

  it('delegates notification-open subscription and cleanup', () => {
    const unsubscribeFirebase = jest.fn();
    mockOnNotificationOpenedApp.mockReturnValueOnce(unsubscribeFirebase);
    const onOpen = jest.fn();

    const unsubscribe = subscribeNotificationOpenedApp(onOpen);

    expect(mockOnNotificationOpenedApp).toHaveBeenCalledWith(onOpen);
    unsubscribe();
    expect(unsubscribeFirebase).toHaveBeenCalledTimes(1);
  });
});
