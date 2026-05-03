module.exports = {
  preset: '@react-native/jest-preset',
  forceExit: true,

  // Setup file to mock native modules
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // pnpm hoists packages to the root node_modules/.pnpm folder
  // We need to transform these ESM packages for Jest
  transformIgnorePatterns: [
    '<rootDir>/../../node_modules/(?!\\.pnpm/(' +
      '@react-native|' +
      'react-native|' +
      '@react-navigation' +
      ').*)',
  ],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    // Intercept @env before babel-dotenv runs so tests never need a real .env file
    '^@env$': '<rootDir>/__mocks__/@env.js',
    // Map @noble/hashes subpath imports to the flat CJS files. The package's
    // `exports` field points subpaths at `./esm/*.js`, but Jest's resolver
    // doesn't honor the `import` condition by default and the package also
    // ships flat CJS at `./*.js`, which is what we want here.
    '^@noble/hashes/(.+)$': '<rootDir>/../../node_modules/@noble/hashes/$1.js',
    // Map image imports to a simple stub so Jest doesn't choke on binary assets
    '\\.(png|jpg|jpeg|gif|webp|svg)$': '<rootDir>/__mocks__/fileMock.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '__tests__/testUtils\\.ts$'],
  // GitHub Actions runners are noticeably slower than local; the default 5s
  // jest timeout occasionally trips RN ReactTestRenderer.act flows that
  // schedule multiple effects (e.g. RecommendationModal "Alts" flow).
  testTimeout: 30000,
  // Coverage configuration
  coverageDirectory: './coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/types/**',
  ],
  coverageThreshold: {
    global: {
      branches: 15,
      functions: 20,
      lines: 25,
      statements: 25,
    },
  },};
  