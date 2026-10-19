/**
 * The checks `npm run data` runs before every write, and `check` runs on
 * stored data (openspec/changes/archive/2026-10-19-move-runtime-data-to-db, design D6). Each
 * collects every issue as { dataset, path, message }, so an operator sees all
 * of them at once:
 *
 *   1. the dataset's schema (later checks need its parsed output, so a schema
 *      failure stops there);
 *   2. its `issuesOf(parsed, { storedOf })`, where `storedOf(name)` is the
 *      parsed data being checked when `name` is its own dataset, the parsed
 *      stored data of any other in the target database, or null when none is
 *      stored or it no longer parses: a check that needs another dataset's
 *      content, not only its ids, reads the copy that database serves
 *      (move-miniapp-registry D6);
 *   3. outgoing references: each identity it names is in the target's stored
 *      `idsOf` (the same `storedOf`), or in a code-held source of the catalog;
 *   4. incoming references: each stored dataset that names this one still
 *      resolves against the data being checked.
 *
 * Two checks may flag the same value (home-layout's registry issue and its
 * reference to `miniapps` name the same tile id), so issues are kept once per
 * dataset and path, the first one found.
 *
 * `stored` maps a dataset name to its stored `data`.
 */

const DATASETS = "datasets";

function zodIssues(dataset, error) {
  return error.issues.map((issue) => ({ dataset, path: issue.path, message: issue.message }));
}

function onePerPath(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.dataset}\u0000${issue.path.join("\u0000")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function entryOf(catalog, name) {
  const entry = catalog.datasets[name];
  if (!entry) throw new Error(`unknown dataset "${name}" (known: ${Object.keys(catalog.datasets).join(", ")})`);
  return entry;
}

/** The parsed stored data of `name`, or null when nothing is stored or it no longer parses. */
function parsedStored(catalog, name, stored) {
  if (stored[name] === undefined) return null;
  const result = entryOf(catalog, name).schema.safeParse(stored[name]);
  return result.success ? result.data : null;
}

/** The data being checked under its own name, else the parsed stored data of `name`, else null. */
function storedOf(catalog, context, name) {
  if (name === context.name) return context.parsed;
  return catalog.datasets[name] ? parsedStored(catalog, name, context.stored) : null;
}

function resolves(catalog, ref, context) {
  const source = catalog.sources[ref.dataset];
  if (source) return { ok: source.has(ref.id) };
  const target = catalog.datasets[ref.dataset];
  if (!target || !target.idsOf) return { ok: false, note: " (not a dataset others may reference)" };
  const data = storedOf(catalog, context, ref.dataset);
  if (data === null) return { ok: false, note: " (no stored dataset)" };
  return { ok: target.idsOf(data).includes(ref.id) };
}

function outgoingIssues(catalog, context) {
  const refs = entryOf(catalog, context.name).referencesOf(context.parsed);
  return refs.flatMap((ref) => {
    const { ok, note = "" } = resolves(catalog, ref, context);
    return ok ? [] : [{ dataset: context.name, path: ref.path, message: `"${ref.id}" is not in ${ref.dataset}${note}` }];
  });
}

function incomingIssues(catalog, { name, parsed, stored }) {
  const entry = entryOf(catalog, name);
  if (!entry.idsOf) return [];
  const ids = new Set(entry.idsOf(parsed));
  return Object.keys(catalog.datasets)
    .filter((other) => other !== name)
    .flatMap((other) => {
      const data = parsedStored(catalog, other, stored);
      if (data === null) return [];
      return catalog.datasets[other]
        .referencesOf(data)
        .filter((ref) => ref.dataset === name && !ids.has(ref.id))
        .map((ref) => ({ dataset: other, path: ref.path, message: `"${ref.id}" is no longer in ${name}` }));
    });
}

/** Every issue of `data` as dataset `name`, given the other datasets' `stored` data. */
function checkData(catalog, name, data, stored) {
  const entry = entryOf(catalog, name);
  const result = entry.schema.safeParse(data);
  if (!result.success) return zodIssues(name, result.error);
  const context = { name, parsed: result.data, stored };
  const own = entry.issuesOf ? entry.issuesOf(result.data, { storedOf: (other) => storedOf(catalog, context, other) }).map((issue) => ({ dataset: name, ...issue })) : [];
  return onePerPath([...own, ...outgoingIssues(catalog, context), ...incomingIssues(catalog, context)]);
}

/** Every catalog dataset's stored `data`, by name, and its revision. Reads only. */
async function readStored(db, catalog) {
  const docs = await db
    .collection(DATASETS)
    .find({ _id: { $in: Object.keys(catalog.datasets) } }, { projection: { revision: 1, data: 1 } })
    .toArray();
  return {
    stored: Object.fromEntries(docs.map((doc) => [doc._id, doc.data])),
    revisions: Object.fromEntries(docs.map((doc) => [doc._id, doc.revision])),
  };
}

/** `check`: the issues of the stored data of `names`. Writes nothing. */
async function checkStored(db, catalog, names) {
  names.forEach((name) => entryOf(catalog, name));
  const { stored, revisions } = await readStored(db, catalog);
  const present = names.filter((name) => stored[name] !== undefined);
  return {
    checked: present.map((dataset) => ({ dataset, revision: revisions[dataset] })),
    missing: names.filter((name) => stored[name] === undefined),
    issues: onePerPath(present.flatMap((name) => checkData(catalog, name, stored[name], stored))),
  };
}

module.exports = { checkData, checkStored, readStored };
