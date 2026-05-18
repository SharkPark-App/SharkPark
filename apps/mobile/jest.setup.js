/**
 * Jest setup file for React Native
 * Mocks native modules that aren't available in the test environment
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// Mock @sentry/react-native — the native SDK isn't available in jest
// and we don't want test runs to ping the Sentry ingest endpoint.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: (component) => component,
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  withScope: jest.fn((cb) => cb({ setTag: jest.fn(), setContext: jest.fn() })),
}));

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  return {
    Swipeable: View,
    DrawerLayout: View,
    State: {},
    ScrollView: View,
    Slider: View,
    Switch: View,
    TextInput: View,
    ToolbarAndroid: View,
    ViewPagerAndroid: View,
    DrawerLayoutAndroid: View,
    WebView: View,
    NativeViewGestureHandler: View,
    TapGestureHandler: View,
    FlingGestureHandler: View,
    ForceTouchGestureHandler: View,
    LongPressGestureHandler: View,
    PanGestureHandler: View,
    PinchGestureHandler: View,
    RotationGestureHandler: View,
    RawButton: View,
    BaseButton: View,
    RectButton: View,
    BorderlessButton: View,
    FlatList: View,
    gestureHandlerRootHOC: jest.fn(),
    Directions: {},
    GestureHandlerRootView: View,
    GestureDetector: View,
    Gesture: {
      Pan: () => ({
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onFinalize: jest.fn().mockReturnThis(),
      }),
      Pinch: () => ({
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onFinalize: jest.fn().mockReturnThis(),
      }),
      Simultaneous: jest.fn(() => ({
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        onFinalize: jest.fn().mockReturnThis(),
      })),
    },
  };
});

// Mock react-native-screens
jest.mock('react-native-screens', () => {
  const View = require('react-native').View;
  return {
    enableScreens: jest.fn(),
    Screen: View,
    ScreenContainer: View,
    ScreenStack: View,
    ScreenStackHeaderConfig: View,
    ScreenStackHeaderSubview: View,
    ScreenStackHeaderBackButtonImage: View,
    ScreenStackHeaderRightView: View,
    ScreenStackHeaderLeftView: View,
    ScreenStackHeaderCenterView: View,
    ScreenStackHeaderSearchBarView: View,
    SearchBar: View,
    NativeScreen: View,
    NativeScreenContainer: View,
    NativeScreenNavigationContainer: View,
    NativeScreenStack: View,
    enableFreeze: jest.fn(),
  };
});

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 0, height: 0 };
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaConsumer: ({ children }) => children(inset),
    SafeAreaView: ({ children }) => children,
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets: inset, frame },
  };
});

// Mock react-native-vector-icons
jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');

// Mock react-native-localize so usesFahrenheit / getDeviceLocale resolve
// deterministically in tests (defaults to en-US / Fahrenheit). `useLocalize`
// is a no-op subscription that just returns the same snapshot every render.
jest.mock('react-native-localize', () => {
  const snapshot = {
    locales: [
      { countryCode: 'US', languageTag: 'en-US', languageCode: 'en', isRTL: false },
    ],
    country: 'US',
    currencies: ['USD'],
    calendar: 'gregorian',
    temperatureUnit: 'fahrenheit',
    timeZone: 'America/Los_Angeles',
    numberFormatSettings: { decimalSeparator: '.', groupingSeparator: ',' },
    uses24HourClock: false,
    usesMetricSystem: false,
    usesAutoDateAndTime: true,
    usesAutoTimeZone: true,
  };
  return {
    getLocales: () => snapshot.locales,
    getTemperatureUnit: () => snapshot.temperatureUnit,
    getNumberFormatSettings: () => snapshot.numberFormatSettings,
    getCalendar: () => snapshot.calendar,
    getCountry: () => snapshot.country,
    getCurrencies: () => snapshot.currencies,
    getTimeZone: () => snapshot.timeZone,
    uses24HourClock: () => snapshot.uses24HourClock,
    usesMetricSystem: () => snapshot.usesMetricSystem,
    usesAutoDateAndTime: () => snapshot.usesAutoDateAndTime,
    usesAutoTimeZone: () => snapshot.usesAutoTimeZone,
    findBestLanguageTag: () => ({ languageTag: 'en-US', isRTL: false }),
    useLocalize: () => snapshot,
    openAppLanguageSettings: jest.fn(),
  };
});

// Mock @react-navigation/native
jest.mock('@react-navigation/native', () => {
  const actualNav = jest.requireActual('@react-navigation/native');
  return {
    ...actualNav,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      dispatch: jest.fn(),
    }),
    useRoute: () => ({
      params: {},
    }),
    useIsFocused: () => true,
    NavigationContainer: ({ children }) => children,
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  
  return {
    default: {
      View: View,
      Text: require('react-native').Text,
      Image: require('react-native').Image,
      ScrollView: require('react-native').ScrollView,
      createAnimatedComponent: (component) => component,
    },
    useSharedValue: (value) => ({ value }),
    useAnimatedStyle: (callback) => callback(),
    withTiming: (value) => value,
    withSpring: (value) => value,
    withDecay: (value) => value,
    withRepeat: (value) => value,
    withSequence: (...values) => values[0],
    Easing: {
      linear: (t) => t,
      ease: (t) => t,
      quad: (t) => t,
      cubic: (t) => t,
      bezier: () => (t) => t,
    },
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
  };
});

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Silence noisy console output during tests.
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
