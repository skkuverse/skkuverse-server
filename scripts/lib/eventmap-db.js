/**
 * Mongo helpers shared by the event map scripts (skkuverse#13, Phase 1).
 *
 * Kept separate from map-places-file.js so that module stays pure and testable,
 * and separate from the scripts themselves so neither has to require the other
 * (and inherit its argv parsing and process.exit calls).
 *
 * No dotenv here — the executable scripts load it. Requiring this file has no
 * side effects.
 */
const { readDataset } = require("./datasets/store");
const { upsertDocs } = require("./upsert-docs");

/**
 * eventmap DB name, with the same _dev/_test suffixing infra/config.ts applies.
 *
 * Duplicated from config.ts rather than imported because scripts are plain
 * CommonJS excluded from tsconfig, and config.ts would process.exit(1) on any
 * unrelated missing env var — an ops script must not depend on the full server
 * config being present. Mirrors scripts/seed-connections.js:17-24.
 */
function resolveDbName() {
  const base = process.env.MONGO_EVENTMAP_DB_NAME;
  if (!base) {
    throw new Error("MONGO_EVENTMAP_DB_NAME not set in .env");
  }
  const nodeEnv = process.env.NODE_ENV || "development";
  if (nodeEnv === "production") return base;
  if (nodeEnv === "test") return `${base}_test`;
  return `${base}_dev`;
}

/**
 * The content database (`npm run data`'s datasets) on the same side as
 * resolveDbName: the importer checks a sheet against the registry of the
 * environment it writes to, never the other one.
 */
function resolveContentDbName() {
  const base = process.env.MONGO_CONTENT_DB_NAME;
  if (!base) {
    throw new Error("MONGO_CONTENT_DB_NAME not set in .env");
  }
  const nodeEnv = process.env.NODE_ENV || "development";
  if (nodeEnv === "production") return base;
  if (nodeEnv === "test") return `${base}_test`;
  return `${base}_dev`;
}

/**
 * The mini app ids the stored `miniapps` dataset registers: what the server
 * serves a `miniapp` action against. With no registry stored there is nothing
 * to check against, so the import stops rather than passing every id.
 */
async function readMiniAppIds(db) {
  const stored = await readDataset(db, "miniapps");
  if (!stored) {
    throw new Error(`no miniapps dataset in ${db.databaseName}: push it with \`npm run data -- push miniapps\` first`);
  }
  return stored.data.index.miniApps.map((entry) => entry.id);
}

/** Everything the sheet owns. `updatedAt` is excluded — see upsertPlaces. */
const COMPARED_FIELDS = [
  "layerSetId",
  "campus",
  "category",
  "location",
  "title",
  "subtitle",
  "hours",
  "fields",
  "actions",
  "order",
  "facets",
  "orderByOption",
  // Easy to forget and silent when forgotten: a field missing here is still
  // written for a NEW place, but an edit that changes only this field reads as
  // "unchanged" and never lands.
  "detail",
];

/**
 * Upserts only the places that actually differ from what is stored.
 *
 * The diff is not an optimisation — 61 documents would cost nothing to rewrite.
 * It is what keeps `updatedAt` meaningful: the one question it answers, on a
 * festival night, is "did my correction actually land", and an import that
 * stamped every document would answer it the same way whether it had or not.
 *
 * It used to have a second job — the snapshot's contentHash was computed over
 * the contributors, so a no-op import would have thrashed a one-year immutable
 * cache. That tier is gone; the ops question is reason enough on its own.
 */
async function upsertPlaces(collection, docs, now) {
  return upsertDocs(collection, docs, now, COMPARED_FIELDS);
}

/** Create the activation if absent, disabled. Never modifies an existing one. */
async function ensureActivation(collection, layerSetId, now) {
  const result = await collection.updateOne(
    { _id: layerSetId },
    {
      $setOnInsert: {
        activeFrom: null,
        activeUntil: null,
        enabled: false,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  return { created: result.upsertedCount === 1 };
}

/** Turn a layer set on over an explicit window. Demo seed only. */
async function enableActivation(collection, layerSetId, now, activeFrom, activeUntil) {
  await collection.updateOne(
    { _id: layerSetId },
    { $set: { enabled: true, activeFrom, activeUntil, updatedAt: now } },
    { upsert: true },
  );
}

module.exports = {
  enableActivation,
  ensureActivation,
  readMiniAppIds,
  resolveContentDbName,
  resolveDbName,
  upsertPlaces,
};
