// Manual jest mock for react-native-bootsplash.
// The real module calls TurboModuleRegistry.getEnforcing('RNBootSplash') at
// import time, which throws under jest because the native binary isn't loaded.
const VISIBILITY_HIDDEN = 'hidden' as const;

const BootSplash = {
  hide: jest.fn().mockResolvedValue(undefined),
  show: jest.fn().mockResolvedValue(undefined),
  isVisible: jest.fn().mockResolvedValue(false),
  getVisibilityStatus: jest.fn().mockResolvedValue(VISIBILITY_HIDDEN),
};

export default BootSplash;
