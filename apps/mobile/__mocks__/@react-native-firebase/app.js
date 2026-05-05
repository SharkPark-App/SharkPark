// Jest manual mock for @react-native-firebase/app
// The real package instantiates a native event emitter at require-time,
// which crashes in Jest (no native bridge). This stub exposes just enough
// surface for our code to import without errors.
module.exports = {
  default: {},
};
