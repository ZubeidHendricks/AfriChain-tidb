module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.test.ts'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(ts|js)',
    '<rootDir>/src/**/?(*.)(test|spec).(ts|js)'
  ],
  collectCoverageFrom: [
    'src/**/*.(ts|js)',
    '!src/**/*.d.ts',
    '!src/tests/**/*',
    '!src/server.ts',
    '!src/**/*.interface.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  testSequencer: './jest-sequencer.js'
};