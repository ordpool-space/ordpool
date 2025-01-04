import type { Config } from "@jest/types"

const config: Config.InitialOptions = {
  preset: "ts-jest",
  testEnvironment: "node",
  verbose: true,
  automock: false,
  collectCoverage: false,
  collectCoverageFrom: ["./src/**/**.ts"],
  coverageProvider: "babel",
  coverageThreshold: {
    global: {
      lines: 1
    }
  },
  setupFiles: [
    "./testSetup.ts",
  ],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  transform: {
    "^.+\\.ts?$": ["ts-jest", {
      tsconfig: "./tsconfig.debug.json",
      diagnostics: false,
      sourceMap: true
    }],
  },
};
export default config;
