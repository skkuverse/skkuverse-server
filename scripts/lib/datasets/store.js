/**
 * How `npm run data` stores a dataset in the content database
 * (ADR 0013, D3 and D4). The server only
 * reads `datasets`; this file is its one writer, and the only reader and
 * writer of `dataset_revisions`.
 *
 *   datasets           { _id: <dataset>, revision, data, updatedAt, updatedBy }
 *   dataset_revisions  { _id: "<dataset>@<revision>", dataset, revision, data,
 *                        savedAt, savedBy, command, note?, rolledBackTo?,
 *                        copiedFrom?: { database, revision } }
 *
 * Write order, with no transaction:
 *
 *   1. the conditional update (or the insert of revision 1) of `datasets`:
 *      only one writer can win it, so a stale base writes nothing;
 *   2. the winner writes its history entry;
 *   3. the winner prunes the entries older than the newest RETAINED_REVISIONS,
 *      which never reaches the current revision.
 *
 * A writer that dies between 1 and 2 leaves the served revision without an
 * entry: `repair` records it from the dataset on the next run.
 *
 * Every function takes a mongodb `Db` and returns a result, `{ ok: true,
 * revision }` or `{ ok: false, reason, ... }`; only a database failure throws.
 * Nothing here prints, and nothing here sees MONGO_URL.
 */

const DATASETS = "datasets";
const REVISIONS = "dataset_revisions";
const RETAINED_REVISIONS = 50;
const DUPLICATE_KEY = 11000;

const entryId = (dataset, revision) => `${dataset}@${revision}`;

function currentOf(doc) {
  return { revision: doc.revision, updatedBy: doc.updatedBy, updatedAt: doc.updatedAt };
}

function readDataset(db, dataset) {
  return db.collection(DATASETS).findOne({ _id: dataset });
}

async function writeEntry(db, dataset, revision, data, meta) {
  const entry = {
    _id: entryId(dataset, revision),
    dataset,
    revision,
    data,
    savedAt: meta.now,
    savedBy: meta.by,
    command: meta.command,
  };
  for (const key of ["note", "rolledBackTo", "copiedFrom"]) {
    if (meta[key] !== undefined) entry[key] = meta[key];
  }
  const revisions = db.collection(REVISIONS);
  await revisions.createIndex({ dataset: 1, revision: -1 });
  // replaceOne, not insertOne: a repair may have recorded this revision first, and the winner's entry is the true one.
  await revisions.replaceOne({ _id: entry._id }, entry, { upsert: true });
  await revisions.deleteMany({ dataset, revision: { $lte: revision - RETAINED_REVISIONS } });
}

async function insertFirst(db, dataset, data, meta) {
  try {
    await db.collection(DATASETS).insertOne({ _id: dataset, revision: 1, data, updatedAt: meta.now, updatedBy: meta.by });
  } catch (err) {
    if (err.code !== DUPLICATE_KEY) throw err;
    return { ok: false, reason: "exists", current: currentOf(await readDataset(db, dataset)) };
  }
  await writeEntry(db, dataset, 1, data, meta);
  return { ok: true, revision: 1 };
}

async function updateFrom(db, dataset, data, meta) {
  const revision = meta.baseRevision + 1;
  const result = await db
    .collection(DATASETS)
    .updateOne(
      { _id: dataset, revision: meta.baseRevision },
      { $set: { data, revision, updatedAt: meta.now, updatedBy: meta.by } },
    );
  if (result.matchedCount === 0) {
    const current = await readDataset(db, dataset);
    return current === null ? { ok: false, reason: "missing" } : { ok: false, reason: "conflict", current: currentOf(current) };
  }
  await writeEntry(db, dataset, revision, data, meta);
  return { ok: true, revision };
}

/** `baseRevision: null` stores revision 1 and refuses an existing dataset. */
function write(db, dataset, data, meta) {
  return meta.baseRevision === null ? insertFirst(db, dataset, data, meta) : updateFrom(db, dataset, data, meta);
}

/** Revision 1 of a new dataset. `{ ok: false, reason: "exists", current }` when it exists. */
function create(db, dataset, data, { by, now, note }) {
  return write(db, dataset, data, { baseRevision: null, by, now, note, command: "create" });
}

/**
 * The next revision, only while the dataset is still at `baseRevision`.
 * `{ ok: false, reason: "conflict", current }` when it moved on, `"missing"` when there is none.
 */
function push(db, dataset, data, { baseRevision, by, now, note }) {
  return write(db, dataset, data, { baseRevision, by, now, note, command: "push" });
}

/** One stored revision's entry, or why there is none: `"pruned"` with `oldestKept`, or `"no-revision"`. */
async function readRevision(db, dataset, revision) {
  const revisions = db.collection(REVISIONS);
  const entry = await revisions.findOne({ _id: entryId(dataset, revision) });
  if (entry !== null) return { ok: true, entry };
  const oldest = await revisions.find({ dataset }).sort({ revision: 1 }).limit(1).next();
  return oldest !== null && revision < oldest.revision
    ? { ok: false, reason: "pruned", oldestKept: oldest.revision }
    : { ok: false, reason: "no-revision" };
}

/** Revision `to`'s data as the next revision, marked `rolledBackTo`. History is never rewritten. */
async function rollback(db, dataset, to, { baseRevision, by, now, note }) {
  const found = await readRevision(db, dataset, to);
  if (!found.ok) return found;
  return write(db, dataset, found.entry.data, { baseRevision, by, now, note, command: "rollback", rolledBackTo: to });
}

/**
 * `source`'s data at `sourceRevision`, the revision the caller checked, as the
 * next revision of `target`, recording `copiedFrom`. `{ ok: false, reason:
 * "source-moved", checked, current }` when source is at another revision now.
 * `baseRevision` is target's revision read at start, or null when target has none.
 * Nothing is written to `source`.
 */
async function copy(source, target, dataset, { sourceRevision, baseRevision, by, now, note }) {
  const from = await readDataset(source, dataset);
  if (from === null) return { ok: false, reason: "missing" };
  if (from.revision !== sourceRevision) return { ok: false, reason: "source-moved", checked: sourceRevision, current: currentOf(from) };
  const copiedFrom = { database: source.databaseName, revision: from.revision };
  return write(target, dataset, from.data, { baseRevision, by, now, note, command: "copy-prod-to-dev", copiedFrom });
}

/** Records the current revision's missing history entry from the dataset document. */
async function repair(db, dataset) {
  const current = await readDataset(db, dataset);
  if (current === null) return { repaired: false };
  const entry = {
    dataset,
    revision: current.revision,
    data: current.data,
    savedAt: current.updatedAt,
    savedBy: current.updatedBy,
    command: "push",
    note: "recorded by repair",
  };
  const result = await db
    .collection(REVISIONS)
    .updateOne({ _id: entryId(dataset, current.revision) }, { $setOnInsert: entry }, { upsert: true });
  return result.upsertedCount === 1 ? { repaired: true, revision: current.revision } : { repaired: false };
}

/** The current revision when its history entry is missing, without writing; else null. */
async function findUnrecorded(db, dataset) {
  const current = await readDataset(db, dataset);
  if (current === null) return null;
  const entry = await db.collection(REVISIONS).findOne({ _id: entryId(dataset, current.revision) }, { projection: { _id: 1 } });
  return entry === null ? current.revision : null;
}

/** History entries, newest first. */
function history(db, dataset, { limit = RETAINED_REVISIONS } = {}) {
  return db.collection(REVISIONS).find({ dataset }).sort({ revision: -1 }).limit(limit).toArray();
}

module.exports = {
  RETAINED_REVISIONS,
  copy,
  create,
  findUnrecorded,
  history,
  push,
  readDataset,
  readRevision,
  repair,
  rollback,
};
