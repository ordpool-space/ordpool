module.exports = {
  preset: 'jest-preset-angular',
  // testMatch: ['**/*.jest.ts'],
  testPathIgnorePatterns: ['<rootDir>/cypress/'],
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  maxWorkers: 1,
  // Path aliases from tsconfig.app.json -- Jest doesn't read them automatically.
  // Without these, tests importing @components/* or @app/* fail with TS2307.
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@components/(.*)$': '<rootDir>/src/app/components/$1',
    '^@environments/(.*)$': '<rootDir>/src/environments/$1',
    '^@interfaces/(.*)$': '<rootDir>/src/app/interfaces/$1',
  },
};
