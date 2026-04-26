module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: ".*\\.e2e-spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  setupFiles: ["dotenv/config"],
  // Fail fast instead of hanging on stray open handles (Sentry background
  // flush loop, pino transports, etc.). Each test is capped at 30s; the
  // whole worker is force-killed once all tests resolve so CI cannot block
  // for the 6h GitHub Actions job timeout.
  testTimeout: 30000,
  forceExit: true,
  detectOpenHandles: false
};
