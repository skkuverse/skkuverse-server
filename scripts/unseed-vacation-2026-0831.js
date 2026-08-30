#!/usr/bin/env node
/**
 * (An operations detail is left out of the public history.)
 *
 *
 *
 *
 *
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const DRY_RUN = process.argv.includes("--dry-run");

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("MONGO_URL not set in .env");
  process.exit(1);
}

const DB_NAME = "bus_campus";

// The first day of the new semester — its override is what must go.
const SEMESTER_START = "2026-08-31";
const SERVICE_IDS = ["campus-inja", "campus-jain"];

const filter = { date: SEMESTER_START, serviceId: { $in: SERVICE_IDS } };

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log(`Connected to MongoDB -> ${DB_NAME}`);

  const col = client.db(DB_NAME).collection("bus_overrides");

  const doomed = await col.find(filter).toArray();
  console.log(`\nOverrides to delete on ${SEMESTER_START}: ${doomed.length}`);
  doomed.forEach((d) => {
    console.log(`  ${d.date} ${d.serviceId} label=${d.label} entries=${JSON.stringify(d.entries)}`);
  });

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No writes performed. Remove --dry-run to delete.");
    await client.close();
    return;
  }

  const result = await col.deleteMany(filter);
  console.log(`\nDeleted: ${result.deletedCount}`);

  // Verify: nothing left on or after the semester start, and the last
  // remaining vacation day is the Friday before it.
  const remaining = await col.countDocuments({
    serviceId: { $in: SERVICE_IDS },
    date: { $gte: SEMESTER_START },
  });
  const last = await col
    .find({ serviceId: { $in: SERVICE_IDS } })
    .sort({ date: -1 })
    .limit(2)
    .toArray();

  console.log(`\nVerification: ${remaining} override docs remain on/after ${SEMESTER_START} (expected 0)`);
  console.log("Last remaining vacation days:");
  last.forEach((d) => console.log(`  ${d.date} ${d.serviceId} label=${d.label}`));

  await client.close();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
