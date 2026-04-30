module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    // ts-jest needs `allowJs` to transpile jose's ESM `.js` source down to
    // CJS for the Jest runtime (see transformIgnorePatterns below).
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: { allowJs: true } }],
  },
  // jose v6 (transitive dep of jwks-rsa >=4) ships ESM only. By default Jest
  // skips transforming anything in node_modules, so its `export` syntax
  // crashes the CJS test runner. Allow jose through the transform.
  transformIgnorePatterns: ["/node_modules/(?!jose/)"],
  coverageDirectory: "./coverage",
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.module.ts",
    "!src/main.ts",
    "!src/**/*.interface.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 35,
      lines: 40,
      statements: 40,
    },
  },
};
