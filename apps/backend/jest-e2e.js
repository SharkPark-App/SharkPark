module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: ".*\\.e2e-spec\\.ts$",
  transform: {
    // ts-jest needs `allowJs` to transpile jose's ESM `.js` source down to
    // CJS for the Jest runtime (see transformIgnorePatterns below).
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: { allowJs: true } }],
  },
  // jose v6 (transitive dep of jwks-rsa >=4) ships ESM only. By default Jest
  // skips transforming anything in node_modules, so its `export` syntax
  // crashes the CJS test runner. Allow jose through the transform.
  transformIgnorePatterns: ["/node_modules/(?!jose/)"],
  setupFiles: ["dotenv/config"],
  // Fail fast instead of hanging on stray open handles (Sentry background
  // flush loop, pino transports, etc.). Each test is capped at 30s; the
  // whole worker is force-killed once all tests resolve so CI cannot block
  // for the 6h GitHub Actions job timeout.
  testTimeout: 30000,
  forceExit: true,
  detectOpenHandles: false
};
