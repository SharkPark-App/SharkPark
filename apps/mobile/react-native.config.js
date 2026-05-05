module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ['./assets/fonts'],
  dependencies: {
    // v2.0.0 dropped the android autolinking metadata from package.json,
    // so the RN CLI won't detect it without this explicit config.
    'react-native-get-random-values': {
      platforms: {
        android: {
          packageImportPath: 'import org.linusu.RNGetRandomValuesPackage;',
          packageInstance: 'new RNGetRandomValuesPackage()',
        },
      },
    },
  },
};
