module.exports = {
  preset: 'jest-preset-angular',
  // testMatch: ['**/*.jest.ts'],
  testPathIgnorePatterns: ['<rootDir>/cypress/'],
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  maxWorkers: 1
};