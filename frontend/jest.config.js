/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  // this test emulates a browser environment
  testEnvironment: 'jsdom',
  testMatch: ['**/*.jest.ts'],
  setupFilesAfterEnv: ['<rootDir>/setup-jest.js']
};
