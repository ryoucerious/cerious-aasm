module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/electron'],
  testMatch: [
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'electron/**/*.ts',
    '!electron/**/*.d.ts',
    '!electron/**/*.spec.ts',
    '!electron/**/*.test.ts'
  ],
  coverageDirectory: 'coverage-electron',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 10000,
  clearMocks: true,
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/dist-electron/'
  ]
};