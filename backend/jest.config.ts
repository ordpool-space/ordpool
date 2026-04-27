import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  verbose: true,
  automock: false,
  collectCoverage: false,
  collectCoverageFrom: ['./src/**/**.ts'],
  coverageProvider: 'v8',
  coverageThreshold: {
    global: {
      lines: 1
    }
  },
  setupFiles: [
    './testSetup.ts',
  ],
  testPathIgnorePatterns: [
    '/dist/',
    '/node_modules/',
    '/__integration_tests__/',
    'test-utils\\.ts$',
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: {
    '^.+\\.ts?$': ['ts-jest', {
      tsconfig: './tsconfig.debug.json',
      diagnostics: false,
      sourceMap: true
    }],
  },
  maxWorkers: 1,
  // BackendInfo singleton starts a setInterval + HTTP request to bitcoind at import time.
  // Any test that transitively imports Common -> blocks -> BackendInfo will keep Node alive.
  // This is upstream's architectural issue, not ours. Force exit to work around it.
  forceExit: true,
};
export default config;
