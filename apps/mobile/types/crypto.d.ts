/**
 * React Native exposes a global crypto object with getRandomValues
 * (via the Hermes engine), but the TypeScript types don't include it
 * since the DOM lib isn't loaded.
 */
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};
