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
    '/node_modules/',
    '/__integration_tests__/',
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
};
export default config;
