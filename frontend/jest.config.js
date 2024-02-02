// jest.config.js
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: [
    "**/*.jest.ts"
  ]
  // globalSetup: 'jest-preset-angular/global-setup',

};
