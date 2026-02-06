module.exports = {
  preset: 'react-native',

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
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
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
