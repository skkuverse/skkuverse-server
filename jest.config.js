// Every worker runs in UTC, as CI does (ADR 0011, D5): a test
// that leans on the host zone fails on a KST laptop too, instead of passing by
// coincidence with production. Workers inherit this env; Node re-reads TZ on assignment.
process.env.TZ = "UTC";

const fs = require("node:fs");
const path = require("node:path");

// WHY: a checkout without the perimeter overlay answers overlay-mode cases from a stand-in entry; the composed
// gate's real entry at src/private/ wins (ADR 0023, D4).
const HAS_OVERLAY = fs.existsSync(path.join(__dirname, "src/private/perimeter.overlay.ts"));

module.exports = {
  testEnvironment: "node",
  moduleNameMapper: HAS_OVERLAY ? {} : { "^.*/src/private/perimeter\\.overlay$": "<rootDir>/__tests__/helpers/perimeter/stand-in.overlay.ts" },
  setupFiles: ["<rootDir>/__tests__/helpers/esm-flag-guard.ts", "<rootDir>/__tests__/helpers/network-guard.ts", "<rootDir>/jest.setup.ts"],
  // ts-jest only transpiles. Type checking is the job of `npm run typecheck`
  // (tsc --noEmit + tsc -p tsconfig.test.json --noEmit), so `diagnostics: false`
  // avoids duplicate work and keeps the test loop fast. tsconfig path points to
  // the test-specific config (lax noUncheckedIndexedAccess / noUnusedLocals for
  // tests). `isolatedModules` moved to tsconfig.json compilerOptions per ts-jest
  // v30 deprecation migration path.
  transform: {
    "^.+\\.ts$": ["ts-jest", { diagnostics: false, tsconfig: "tsconfig.test.json" }],
  },
  moduleFileExtensions: ["ts", "js", "json", "node"],
  // Anything under __tests__/helpers is shared test infrastructure (mock factories,
  // app builders), not a test suite. Without this, Jest's default __tests__/**
  // matcher would treat each helper module as a test and fail it for having zero it() blocks.
  // Unit tests sit next to their sources as src/**/*.spec.ts (Jest's default
  // testMatch finds them). `npm run build` leaves a dist/ copy of src/, which
  // must never be collected or resolved as a second module tree, and neither
  // must a Claude Code isolation worktree, a full checkout under .claude/worktrees/.
  // WHY: anchored at <rootDir>, because a pattern matches the absolute path and a worktree's own root sits under one.
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/helpers/", "/dist/", "<rootDir>/.claude/worktrees/"],
  modulePathIgnorePatterns: ["/dist/", "<rootDir>/.claude/worktrees/"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  coveragePathIgnorePatterns: ["/node_modules/", "/__tests__/helpers/", "\\.spec\\.ts$"],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 75,
      statements: 75,
    },
  },
};
