/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Suppress InteractionManager deprecation warning from React Navigation
// TODO: Remove when React Navigation updates to use requestIdleCallback
if (__DEV__) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0]?.includes?.('InteractionManager has been deprecated')) {
      return;
    }
    originalWarn.apply(console, args);
  };
}

// Register the main app component
AppRegistry.registerComponent(appName, () => App);

// Ensure HMR client is properly registered for hot module replacement
if (__DEV__ && module.hot) {
  module.hot.accept();
}
