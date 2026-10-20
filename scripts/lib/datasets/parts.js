/**
 * How `npm run data` stores a parted dataset (openspec/changes/move-reference-datasets,
 * design D4): a dataset too large for one document is its `datasets` header,
 * whose data is a manifest, plus one `dataset_parts` document per part.
 *
 *   datasets       { _id: <dataset>, revision, data: { parts: [{ key, partId, summary }] }, ... }
 *   dataset_parts  { _id: "<dataset>/<key>@<sha256 first 16 hex>", dataset, key, sha256,
 *                    data, savedAt, savedBy }
 *
 * `sha256` is taken over the part's canonical JSON (keys sorted), and `data`
 * is stored in that form, so a pulled part pushed back unedited has the same
 * id. A part never changes once stored: the same content in a later revision
 * names the same document.
 *
 * Write order, with no transaction:
 *
 *   1. upsert every part by `_id` (insert only); an existing `_id` whose full
 *      `sha256` differs stops the run before the header, overwriting nothing;
 *   2. the header's conditional update, its history entry and the pruning of
 *      old revisions, exactly as store.js does for any dataset;
 *   3. garbage collection: delete this dataset's parts that neither the current
 *      header nor a retained revision names, and that were saved more than
 *      PART_GRACE_MS ago.
 *
 * A run that dies before 2 leaves orphan parts and the served revision
 * unchanged; step 3 of a later run removes them. The grace keeps one
 * operator's step 3 from deleting the parts of a concurrent push that has not
 * yet won its step 2.
 *
 * The server reads `dataset_parts` by `_id` only, so no index ships ahead of a
 * deploy (ADR 0012 D3). Step 3's `{ dataset: 1 }` index is created here, as
 * store.js creates `dataset_revisions`' index; no api process runs that query.
 *
 * A part handed in is `{ key, data, summary }`: `data` the part schema's parsed
 * output, `summary` what `history` and the push report show of it.
 */
const { createHash } = require("node:crypto");
const store = require("./store");

const DATASETS = "datasets";
const PARTS = "dataset_parts";
const REVISIONS = "dataset_revisions";
const PART_GRACE_MS = 60 * 60 * 1000;
const PART_ID_HASH_LENGTH = 16;
const DUPLICATE_KEY = 11000;

/** Plain JSON (as JSON.parse returns it) with every object's keys sorted. */
function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, each]) => `${JSON.stringify(key)}:${sortedJson(each)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The JSON a part is hashed and stored as: what JSON.stringify keeps of it, keys sorted. */
const canonicalJson = (value) => sortedJson(JSON.parse(JSON.stringify(value)));

/** The part as it is stored and hashed: `{ key, partId, sha256, data, summary }`. */
function toStoredPart(dataset, { key, data, summary }) {
  const json = canonicalJson(data);
  const sha256 = createHash("sha256").update(json).digest("hex");
  return { key, partId: `${dataset}/${key}@${sha256.slice(0, PART_ID_HASH_LENGTH)}`, sha256, data: JSON.parse(json), summary };
}

/** The header's data: one entry per part, ordered by key. */
function toManifest(storedParts) {
  const entries = storedParts.map(({ key, partId, summary }) => ({ key, partId, summary }));
  return { parts: entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) };
}

const partIdsOf = (manifest) => (Array.isArray(manifest?.parts) ? manifest.parts.map((entry) => entry.partId) : []);

/**
 * Step 1: inserts each part that is not stored yet. `{ ok: false, reason:
 * "collision", partId }` at the first stored `_id` whose full hash differs.
 */
async function storeParts(db, dataset, storedParts, { by, now }) {
  const collection = db.collection(PARTS);
  for (const part of storedParts) {
    try {
      // The filter holds the full hash, so a stored id with another hash makes the upsert's insert a duplicate key.
      await collection.updateOne(
        { _id: part.partId, sha256: part.sha256 },
        { $setOnInsert: { dataset, key: part.key, data: part.data, savedAt: now, savedBy: by } },
        { upsert: true },
      );
    } catch (err) {
      if (err.code !== DUPLICATE_KEY) throw err;
      return { ok: false, reason: "collision", partId: part.partId };
    }
  }
  return { ok: true };
}

/** Step 3: deletes this dataset's parts that no header or retained revision names, saved over PART_GRACE_MS ago. */
async function collectGarbage(db, dataset, { now }) {
  const collection = db.collection(PARTS);
  await collection.createIndex({ dataset: 1 });
  const header = await db.collection(DATASETS).findOne({ _id: dataset }, { projection: { data: 1 } });
  const revisions = await db.collection(REVISIONS).find({ dataset }, { projection: { "data.parts.partId": 1 } }).toArray();
  const named = new Set([header, ...revisions].flatMap((doc) => partIdsOf(doc?.data)));
  const result = await collection.deleteMany({
    dataset,
    _id: { $nin: [...named] },
    savedAt: { $lt: new Date(now.getTime() - PART_GRACE_MS) },
  });
  return { deleted: result.deletedCount };
}

async function writeParted(db, dataset, parts, meta, writeHeader) {
  const storedParts = parts.map((part) => toStoredPart(dataset, part));
  const stored = await storeParts(db, dataset, storedParts, meta);
  if (!stored.ok) return stored;
  const result = await writeHeader(toManifest(storedParts));
  if (result.ok) await collectGarbage(db, dataset, meta);
  return result;
}

/** Revision 1 of a new parted dataset; refuses an existing one as store.create does. */
function create(db, dataset, parts, { by, now, note }) {
  return writeParted(db, dataset, parts, { by, now }, (manifest) => store.create(db, dataset, manifest, { by, now, note }));
}

/** The next revision, only while the header is still at `baseRevision` (store.push). */
function push(db, dataset, parts, { baseRevision, by, now, note }) {
  return writeParted(db, dataset, parts, { by, now }, (manifest) => store.push(db, dataset, manifest, { baseRevision, by, now, note }));
}

module.exports = { PART_GRACE_MS, collectGarbage, create, push, toManifest, toStoredPart };
