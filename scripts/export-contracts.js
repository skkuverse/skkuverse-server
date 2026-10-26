#!/usr/bin/env node
/**
 * Regenerate or check the produced contracts in contracts/produced/: one
 * draft-07 `<id>.schema.json` per `.wire` export, and `index.json` (id → source,
 * export, routes). Fixtures under contracts/produced/fixtures/ are hand-trimmed
 * and never written here. Policy: docs/decisions/0010-server-architecture.md D13.
 *
 * Usage:
 *   npm run contracts:export               # rewrite contracts/produced/ from src/**\/*.wire.ts
 *   npm run contracts:export -- --check    # exit 1 if contracts/produced/ is stale (npm test runs the same check)
 *
 * The export itself lives in the Jest test below, which imports every wire file
 * through ts-jest. A dist/-based script would see drift only after a build,
 * Node's type stripping cannot resolve the extensionless imports in src/, and
 * ts-node or tsx would be a new dependency. This script only runs that one test
 * file, with CONTRACTS_WRITE=1 unless --check is given.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const EXPORT_TEST = "__tests__/contracts/wire-export.test.ts";

function parseArgs(argv) {
  const args = { check: false };
  for (const arg of argv) {
    if (arg === "--check") args.check = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // WHY: the produced contracts are public; none is computed from a tree that holds the private perimeter overlay.
  const overlayFolder = path.join("src", "private");
  if (fs.existsSync(path.join(ROOT, overlayFolder))) {
    throw new Error(`${overlayFolder}/ holds the perimeter overlay; remove it before exporting the contracts`);
  }
  if (!fs.existsSync(path.join(ROOT, EXPORT_TEST))) {
    throw new Error(`${EXPORT_TEST} is missing; it computes and compares the artifacts`);
  }

  const env = { ...process.env };
  // A CONTRACTS_WRITE left exported in the shell must not turn --check into a write.
  delete env.CONTRACTS_WRITE;
  if (!args.check) env.CONTRACTS_WRITE = "1";

  // One file cannot meet the global coverage thresholds in jest.config.js, so
  // coverage is off; npm test still runs this file with coverage on.
  const result = spawnSync(
    process.execPath,
    [require.resolve("jest/bin/jest"), "--coverage=false", "--runTestsByPath", EXPORT_TEST],
    { cwd: ROOT, env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (err) {
  console.error(`export-contracts: ${err.message}`);
  process.exitCode = 1;
}
