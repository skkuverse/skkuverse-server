#!/usr/bin/env node
/**
 * Bring a festival's event map back on the `_dev` databases for a UI test, in
 * one command: sync `<eventmap>_dev.places` to the committed sheet, then open a
 * dev activation window.
 *
 * Usage:
 *   npm run eventmap:revive-dev [-- --minutes <n>] [--file <path>] [--layer-set-id <id>]
 *
 *   --minutes <n>          length of the dev window. Default 240
 *   --file <path>          the sheet. Default: the committed one (scripts/data/eskara-2026-places.json),
 *                          whose synthetic handles the importer accepts only outside production
 *   --layer-set-id <id>    default: the importer's and the window script's (eskara-2026)
 *
 * It only ever writes `_dev`. NODE_ENV=production or `--prod` anywhere in the
 * arguments exits before anything runs, and both steps run as child processes
 * with NODE_ENV=development: that is what makes import-eventmap-places.js
 * resolve `<name>_dev`, and eventmap-window.js is never handed `--prod`.
 *
 * The import passes `--delete-missing`, so `_dev` mirrors the sheet exactly. A
 * dev database left behind by an earlier rehearsal is a stale subset (54 of 77
 * places on 2026-10-09), and a partial revive looks like a rendering bug.
 *
 * What a revive does not bring back:
 * - Only a local server reads `_dev`. Beta and TestFlight builds call
 *   api.skkuverse.com, which reads production. Point a dev build at the local
 *   server with EXPO_PUBLIC_BASE_URL
 *   (docs/how-to/test-the-app-against-a-local-server.md).
 * - The home layout, campus banners and mini-app registry are datasets in the
 *   content database, not eventmap data. Restore them in `_dev` with
 *   `npm run data` (docs/how-to/edit-runtime-data.md).
 * - The app hides festival layers unless its festival gate is open
 *   (`__DEV__ || beta`, or FESTIVAL_OVERRIDE in skkuverse-app).
 */
const { spawnSync } = require("child_process");
const path = require("path");

const DEFAULT_MINUTES = "240";
const DEFAULT_FILE = "scripts/data/eskara-2026-places.json";

function takeValue(argv, i, flag) {
  const value = argv[i];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

/** The two child invocations, or a throw if the request could touch production. */
function planSteps(argv, env) {
  if (env.NODE_ENV === "production") {
    throw new Error("refusing: NODE_ENV=production. This script only writes the _dev databases.");
  }
  if (argv.includes("--prod")) {
    throw new Error("refusing: --prod. This script only writes the _dev databases.");
  }
  let minutes = DEFAULT_MINUTES;
  let file = DEFAULT_FILE;
  let layerSetId = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--minutes") minutes = takeValue(argv, ++i, arg);
    else if (arg === "--file") file = takeValue(argv, ++i, arg);
    else if (arg === "--layer-set-id") layerSetId = takeValue(argv, ++i, arg);
    else throw new Error(`unknown argument: ${arg}`);
  }
  const layerSet = layerSetId ? ["--layer-set-id", layerSetId] : [];
  return [
    ["import-eventmap-places.js", "--file", file, ...layerSet, "--delete-missing"],
    // eventmap-window.js validates --minutes itself (it rejects 1e2, -5, …).
    ["eventmap-window.js", "open", "--minutes", minutes, ...layerSet],
  ];
}

function main() {
  let steps;
  try {
    steps = planSteps(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const root = path.join(__dirname, "..");
  for (const [script, ...args] of steps) {
    console.log(`\n$ node scripts/${script} ${args.join(" ")}   (NODE_ENV=development)`);
    const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { planSteps };
