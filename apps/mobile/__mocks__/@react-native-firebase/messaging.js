// Jest manual mock for @react-native-firebase/messaging
// The real package touches native modules at import time; this stub exposes
// the same API surface our pushNotifications service uses so every test
// that transitively imports it (AuthContext, App, useFavorites, …) works
// without a native bridge.

const AuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
};

const mockMessaging = {
  requestPermission: jest.fn().mockResolvedValue(AuthorizationStatus.AUTHORIZED),
  registerDeviceForRemoteMessages: jest.fn().mockResolvedValue(undefined),
  getToken: jest.fn().mockResolvedValue('mock-fcm-token'),
  onTokenRefresh: jest.fn().mockReturnValue(() => {}),
  onMessage: jest.fn().mockReturnValue(() => {}),
  onNotificationOpenedApp: jest.fn().mockReturnValue(() => {}),
  getInitialNotification: jest.fn().mockResolvedValue(null),
  AuthorizationStatus,
};

// The default export from @react-native-firebase/messaging is a function
// that returns the messaging instance.
const messagingFn = jest.fn(() => mockMessaging);
messagingFn.AuthorizationStatus = AuthorizationStatus;

module.exports = messagingFn;
module.exports.default = messagingFn;
