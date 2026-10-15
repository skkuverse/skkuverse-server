#!/usr/bin/env node
/**
 * Put the bus_overrides `$jsonSchema` validator on bus_campus.bus_overrides, so
 * MongoDB refuses an override the server would drop at read time. The schema is
 * scripts/lib/bus-overrides-validator.js, pinned to the server's busOverrideDoc
 * by __tests__/nest/bus/bus-overrides-validator.test.ts.
 *
 * Usage:
 *   node scripts/apply-bus-overrides-validator.js                 # dry run on bus_campus_dev
 *   node scripts/apply-bus-overrides-validator.js --prod          # dry run on bus_campus
 *   node scripts/apply-bus-overrides-validator.js --apply         # write to bus_campus_dev
 *   node scripts/apply-bus-overrides-validator.js --apply --prod  # write to bus_campus
 *
 * A dry run is the default: it prints the validator the collection has now and
 * every stored document the new one would refuse. --apply refuses to run while
 * any stored document fails, because `validationLevel: "strict"` would then
 * block every later update of that document; fix or delete it first. Flags
 * follow scripts/set-campus-schedule.js (--prod, never NODE_ENV).
 *
 * Idempotent: collMod replaces the validator, and a rerun reads back the same.
 * Undo: `db.runCommand({ collMod: "bus_overrides", validator: {}, validationLevel: "off" })`.
 */
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { MongoClient } = require("mongodb");
const { BUS_OVERRIDES_VALIDATOR } = require("./lib/bus-overrides-validator");

const COLLECTION = "bus_overrides";
const VALIDATION = { validationLevel: "strict", validationAction: "error" };

function parseArgs(argv) {
  const args = { prod: false, apply: false };
  for (const arg of argv) {
    if (arg === "--prod") args.prod = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg !== "--dry-run") throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

/** Same suffixing as scripts/seed-eskara-2026-noservice.js resolveDbName. */
function resolveDbName(isProd) {
  const base = process.env.MONGO_DB_NAME_BUS_CAMPUS;
  if (!base) throw new Error("MONGO_DB_NAME_BUS_CAMPUS not set in .env");
  return isProd ? base : `${base}_dev`;
}

async function collectionOptions(db) {
  const [info] = await db.listCollections({ name: COLLECTION }).toArray();
  if (!info) throw new Error(`${db.databaseName}.${COLLECTION} does not exist`);
  return info.options ?? {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.MONGO_URL) throw new Error("MONGO_URL not set in .env");
  const dbName = resolveDbName(args.prod);
  console.log(`database   ${dbName}${args.prod ? "   <- PRODUCTION" : "   (dev — pass --prod for production)"}`);

  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  try {
    const db = client.db(dbName);
    const before = await collectionOptions(db);
    console.log(`validator  ${before.validator ? JSON.stringify(before.validator) : "(none)"}`);

    const refused = await db
      .collection(COLLECTION)
      .find({ $nor: [BUS_OVERRIDES_VALIDATOR] }, { projection: { serviceId: 1, date: 1, type: 1 } })
      .toArray();
    const total = await db.collection(COLLECTION).countDocuments();
    console.log(`documents  ${total}, of which the new validator refuses ${refused.length}`);
    refused.forEach((d) => console.log(`  ${d._id}  ${d.serviceId}/${d.date}  type=${JSON.stringify(d.type)}`));

    if (!args.apply) {
      console.log("\n[DRY RUN] Nothing written. Pass --apply to set the validator.");
      return;
    }
    if (refused.length > 0) {
      console.error("\nREFUSED: fix or delete the documents above first.");
      process.exitCode = 1;
      return;
    }

    await db.command({ collMod: COLLECTION, validator: BUS_OVERRIDES_VALIDATOR, ...VALIDATION });
    const after = await collectionOptions(db);
    const applied =
      isDeepStrictEqual(after.validator, BUS_OVERRIDES_VALIDATOR) &&
      after.validationLevel === VALIDATION.validationLevel &&
      after.validationAction === VALIDATION.validationAction;
    if (!applied) {
      console.error(`\nFAIL: read back ${JSON.stringify(after)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nVERIFIED — ${dbName}.${COLLECTION} refuses an override busOverrideDoc would drop.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
