module.exports = {
  preset: "ts-jest",
  moduleFileExtensions: [
    "ts",
    "js",
    "cjs",
    "mjs"
  ],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest"
  },
  testEnvironment: "node",
  testMatch: [
    "**/*.jest.ts"
  ]
};
