module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/electron'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'electron/**/*.ts',
    '!electron/**/*.d.ts',
    '!electron/**/*.spec.ts',
    '!electron/**/*.test.ts',
    '!electron/main.js',
    '!electron/**/*.js'
  ],
  coverageDirectory: 'coverage-electron',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/electron/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 10000,
  // Handle Electron-specific modules
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/dist-electron/'
  ],
  // Transform patterns for Electron modules that might need mocking
  transformIgnorePatterns: [
    'node_modules/(?!electron)'
  ]
};