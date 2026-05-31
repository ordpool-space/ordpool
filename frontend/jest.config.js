module.exports = {
  preset: 'jest-preset-angular',
  // testMatch: ['**/*.jest.ts'],
  // playwright/ is excluded so Jest doesn't try to run our browser specs
  // (they import @playwright/test which can't load in the jsdom env and
  // explodes with "Class extends value undefined" out of playwright-core).
  testPathIgnorePatterns: ['<rootDir>/cypress/', '<rootDir>/playwright/'],
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
  // @noble/secp256k1 ships as pure ESM ("type":"module"). Jest skips
  // transforming node_modules by default, so its import lands at runtime
  // as raw ESM and Node throws SyntaxError on the export statement. The
  // pattern below extends jest-preset-angular's default (which keeps
  // *.mjs and @angular/common/locales transforming) with an exception
  // for @noble packages so their .js files get transformed too.
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$|@angular/common/locales/.*\\.js$|@noble/.*))',
  ],
};
