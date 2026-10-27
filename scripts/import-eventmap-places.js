#!/usr/bin/env node
/**
 * Import the ops sheet into eventmap `places`.
 *
 * ONE file, one script. There used to be two of each — a CSV of plots and a JSON
 * of sessions, joined on `placeId` at import time — because a place and its
 * occupancy were separate documents. They are one document now, so there is
 * nothing left to join and the second importer had nothing left to import.
 *
 * The sheet is the source of truth for a layer set; this script is the only way
 * that truth reaches Mongo. It refuses to write anything if any place is bad,
 * because a half-imported map is worse than no map: the missing booths are
 * invisible, and the ones that made it look authoritative.
 *
 * Usage:
 *   node scripts/import-eventmap-places.js [options]
 *
 *   --file <path>          the sheet; required (scripts/data/<layerSetId>-places.json)
 *   --layer-set-id <id>    default eskara-2026
 *   --dry-run              validate and report, write nothing
 *   --delete-missing       delete places absent from the sheet
 *
 * Each `miniapp` action is checked against the mini app registry the server on
 * the same side serves: the `miniapps` dataset of the content database
 * (MONGO_CONTENT_DB_NAME, `_dev` unless NODE_ENV=production, as for eventmap).
 *
 * `--file` has no default, and with NODE_ENV=production a sheet that is not
 * real is refused before anything connects: one whose `_readme` calls it
 * synthetic, or that names an `example_club_` handle. The committed
 * `scripts/data/eskara-2026-places.json` is such a sheet (its Instagram handles
 * are placeholders for the public repository), so importing it into production
 * would overwrite the real handles. Production imports the maintainer's real
 * sheet, kept outside this repository.
 *
 * `--delete-missing` really deletes. There is no `lifecycle: "retired"` to fall
 * back on any more, and that is the point: a cancelled booth is removed from the
 * sheet and removed from Mongo, which is what leaves an empty `hours` free to
 * mean "always open" and nothing else. It is opt-in because a truncated sheet
 * plus an automatic delete is how a festival disappears mid-afternoon.
 */
require("dotenv").config();
const fs = require("fs");
const { MongoClient } = require("mongodb");

const { parsePlacesFile } = require("./lib/map-places-file");
const { ensureActivation, readMiniAppIds, resolveContentDbName, resolveDbName, upsertPlaces } = require("./lib/eventmap-db");

const DEFAULT_LAYER_SET_ID = "eskara-2026";

/**
 * The next argv entry, refusing a flag.
 *
 * `--file --dry-run` would otherwise take "--dry-run" as the filename and
 * silently disarm the dry run — the one flag whose absence is dangerous.
 */
function takeValue(argv, i, flag) {
  const value = argv[i];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    file: null,
    layerSetId: DEFAULT_LAYER_SET_ID,
    dryRun: false,
    deleteMissing: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--delete-missing") args.deleteMissing = true;
    else if (arg === "--file") args.file = takeValue(argv, ++i, "--file");
    else if (arg === "--layer-set-id") args.layerSetId = takeValue(argv, ++i, "--layer-set-id");
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.file) throw new Error("--file is required: the sheet to import, such as scripts/data/<layerSetId>-places.json");
  if (!args.layerSetId) throw new Error("--layer-set-id needs a value");
  return args;
}

const SYNTHETIC_HANDLE = /example_club_/i;

/**
 * Why a sheet must not reach production, or null. A `_readme` that calls the
 * sheet synthetic, or a placeholder handle anywhere in it, marks a sheet made
 * for the public repository rather than one taken from the organisers.
 */
function productionRefusal(text) {
  if (SYNTHETIC_HANDLE.test(text)) return "it names an example_club_ handle, a placeholder for a real one";
  let readme;
  try {
    readme = JSON.parse(text)._readme;
  } catch {
    return null;
  }
  const lines = Array.isArray(readme) ? readme : [readme];
  if (lines.some((line) => typeof line === "string" && /synthetic/i.test(line))) return "its _readme says it holds synthetic data";
  return null;
}

/** How many places carry each number of opening windows. */
function windowHistogram(docs) {
  const counts = new Map();
  for (const doc of docs) {
    counts.set(doc.hours.length, (counts.get(doc.hours.length) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, places]) => `${places}×${n === 0 ? "always" : `${n}w`}`)
    .join("  ");
}

/**
 * The sheet parsed against the mini app registry `contentDb` holds, so a
 * `miniapp` action naming an id that database's server would not serve is
 * refused here rather than dropped at read.
 */
async function parseSheet(text, { layerSetId, contentDb }) {
  const miniAppIds = await readMiniAppIds(contentDb);
  return parsePlacesFile(text, { layerSetId, miniAppIds });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = fs.readFileSync(args.file, "utf8");
  if (process.env.NODE_ENV === "production") {
    const refusal = productionRefusal(text);
    if (refusal) throw new Error(`refusing: ${args.file} is a synthetic sheet, not one for production: ${refusal}`);
  }

  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error("MONGO_URL not set in .env");
    process.exit(1);
  }
  const dbName = resolveDbName();
  const contentDbName = resolveContentDbName();

  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const { docs, errors } = await parseSheet(text, { layerSetId: args.layerSetId, contentDb: client.db(contentDbName) });

    console.log(`file       ${args.file}`);
    console.log(`layerSetId ${args.layerSetId}`);
    console.log(`database   ${dbName}`);
    console.log(`registry   ${contentDbName}`);
    console.log(`parsed     ${docs.length} place(s), ${errors.length} problem(s)`);
    if (docs.length > 0) console.log(`windows    ${windowHistogram(docs)}`);

    // Abort before writing. A rejected place means the sheet is wrong, and
    // importing the other 60 would hide that behind a map that looks fine.
    if (errors.length > 0) {
      console.error("\nRejected — nothing was written:");
      for (const e of errors) console.error(`  ${e}`);
      process.exitCode = 1;
      return;
    }

    const db = client.db(dbName);
    const places = db.collection("places");
    const activations = db.collection("activations");

    const ids = docs.map((d) => d._id);
    const orphans = await places
      .find(
        { layerSetId: args.layerSetId, _id: { $nin: ids } },
        { projection: { _id: 1 } },
      )
      .toArray();

    if (args.dryRun) {
      console.log("\nDRY RUN — no writes performed.");
      reportOrphans(orphans, args.deleteMissing, true);
      return;
    }

    const now = new Date();
    const summary = await upsertPlaces(places, docs, now);
    console.log(
      `\nplaces     ${summary.inserted} inserted, ${summary.updated} updated, ` +
        `${summary.unchanged} unchanged`,
    );

    if (args.deleteMissing && orphans.length > 0) {
      const result = await places.deleteMany({ _id: { $in: orphans.map((o) => o._id) } });
      console.log(`deleted    ${result.deletedCount} places absent from the sheet`);
    } else {
      reportOrphans(orphans, args.deleteMissing, false);
    }

    // Insert-only. See the INVARIANT block in lib/eventmap-db.js: this must
    // never be able to switch a live event off.
    const activation = await ensureActivation(activations, args.layerSetId, now);
    console.log(
      activation.created
        ? `activation created (${args.layerSetId}, enabled: false)`
        : `activation already exists (${args.layerSetId}) — left untouched`,
    );
  } finally {
    await client.close();
  }
}

function reportOrphans(orphans, deleteMissing, dryRun) {
  if (orphans.length === 0) return;
  const verb = dryRun && deleteMissing ? "would be deleted" : "not in the sheet";
  console.log(`\n${orphans.length} place(s) ${verb}:`);
  for (const o of orphans) console.log(`  ${o._id}`);
  if (!deleteMissing) console.log("  (pass --delete-missing to remove them)");
}

// Guard so tests and other scripts can require this file without connecting.
if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, parseSheet, productionRefusal, windowHistogram };
