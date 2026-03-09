const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration for monorepo with pnpm
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    path.resolve(__dirname, '../../node_modules'),
    path.resolve(__dirname, './node_modules'),
    path.resolve(__dirname, '../../packages'),
  ],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, './node_modules'),
      path.resolve(__dirname, '../../node_modules'),
    ],
    disableHierarchicalLookup: false,
  },
  server: {
    // Enhance HMR stability
    enhanceMiddleware: (middleware) => middleware,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
