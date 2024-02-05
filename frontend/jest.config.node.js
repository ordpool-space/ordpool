/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  // this test runs in a normal node environment
  testEnvironment: 'node',
  testMatch: ['**/*.jest.ts'],
  setupFilesAfterEnv: ['<rootDir>/setup-jest.js']
};
