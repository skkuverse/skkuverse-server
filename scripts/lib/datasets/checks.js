/**
 * The checks `npm run data` runs before every write, and `check` runs on
 * stored data (ADR 0013, D5). Each
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
 *      (ADR 0013, D5);
 *   3. outgoing references: each identity it names is in the target's stored
 *      `idsOf` (the same `storedOf`), or in a code-held source of the catalog;
 *   4. incoming references: each stored dataset that names this one still
 *      resolves against the data being checked;
 *   5. rechecks: each stored dataset whose entry names this one in its
 *      `recheckTriggers` runs its own `issuesOf` again over its stored data,
 *      with `storedOf(<this one>)` the data being checked and its own declared
 *      collections; its refusing issues refuse this one, reported as its own,
 *      and its warnings are left out. It catches a change that removes no id
 *      the other cites but still breaks it, such as an alias it relies on.
 *
 * Two checks may flag the same value (home-layout's registry issue and its
 * reference to `miniapps` name the same tile id), so issues are kept once per
 * dataset and path, the first one found.
 *
 * An issue `issuesOf` marks `warning: true` refuses nothing: it is returned
 * apart, as `warnings`, for the push report and `check` to print. A check
 * whose fix belongs to another dataset's push warns instead of refusing, so
 * that push can follow.
 *
 * `stored` maps a dataset name to its stored `data`.
 *
 * A parted dataset (ADR 0013, D1) runs
 * its part schema on each part instead of 1, refuses a key two parts share,
 * and runs 2 to 4 on the set of parts ordered by key. Its stored `data` is a
 * manifest. A dataset whose check needs a parted one's content names it in its
 * entry's `reads`: `readStored`, given the datasets about to be checked, adds
 * each part's `data` to the manifest entries of every dataset they read, from
 * the same database, and `storedOf` hands over those parts parsed with the part
 * schema and ordered by key. It is null when a part is not stored or fails the
 * schema, and for a parted dataset no check reads, whose parts are never
 * fetched.
 *
 * A dataset whose check reads a collection outside the content database
 * declares its key in its entry's `collections`, and the catalog's
 * `collections` names each one. `readStored` and `readCollections` read for a
 * dataset that a checked one triggers a recheck of as for a checked one, its
 * own parts included.
 * `readCollections(catalog, names, readCollection)` reads every collection the
 * datasets `names` declare, once each, through the caller's
 * `readCollection(key, spec)`, which picks the target environment's database
 * (scripts/data.js); `checkStored` does so for the stored datasets it checks.
 * A check reads them with `collectionOf(key)`, null for one that was not read;
 * reading a collection its entry does not declare throws.
 */

const { readParts } = require("./parts");

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

/**
 * A parted dataset's parts, parsed and ordered by key, when readStored added every part's data to its
 * manifest; null when one is missing or fails the part schema.
 */
function parsedParts({ schema }, manifest) {
  if (!Array.isArray(manifest.parts) || manifest.parts.some((entry) => entry.data === undefined)) return null;
  const entries = [...manifest.parts].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const results = entries.map((entry) => schema.safeParse(entry.data));
  return results.every((result) => result.success) ? results.map((result) => result.data) : null;
}

/** The parsed stored data of `name`, or null when nothing is stored or it no longer parses. */
function parsedStored(catalog, name, stored) {
  if (stored[name] === undefined) return null;
  const entry = entryOf(catalog, name);
  if (entry.parts) return parsedParts(entry.parts, stored[name]);
  const result = entry.schema.safeParse(stored[name]);
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

/** The datasets whose entries name `name` in their `recheckTriggers`. */
function recheckersOf(catalog, name) {
  return Object.keys(catalog.datasets).filter((other) => other !== name && (catalog.datasets[other].recheckTriggers ?? []).includes(name));
}

/** `names` and each dataset a check of one of them rechecks. */
function withRecheckers(catalog, names) {
  return [...new Set([...names, ...names.flatMap((name) => recheckersOf(catalog, name))])];
}

/** Each stored rechecker's refusing issues over its stored data, with the data being checked as `storedOf(name)`. */
function recheckIssues(catalog, { name, parsed, stored, collections }) {
  return recheckersOf(catalog, name).flatMap((other) => {
    const entry = catalog.datasets[other];
    const data = parsedStored(catalog, other, stored);
    if (data === null || !entry.issuesOf) return [];
    const context = { name: other, parsed: data, stored, collections };
    const storedOfOther = (dataset) => (dataset === name ? parsed : storedOf(catalog, context, dataset));
    return entry
      .issuesOf(data, { storedOf: storedOfOther, collectionOf: (key) => collectionOf(entry, context, key) })
      .filter((issue) => !issue.warning)
      .map((issue) => ({ dataset: other, ...issue }));
  });
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

/**
 * `{ issues, warnings }` of `data` as dataset `name`, given the other datasets' `stored` data and the
 * `collections` read for its check (readCollections).
 */
function checkContent(catalog, name, data, stored, collections = {}) {
  const entry = entryOf(catalog, name);
  const result = entry.schema.safeParse(data);
  if (!result.success) return { issues: zodIssues(name, result.error), warnings: [] };
  return contentIssues(catalog, entry, { name, parsed: result.data, stored, collections });
}

/** Every issue of `data` as dataset `name` that refuses it, given the other datasets' `stored` data and its `collections`. */
function checkData(catalog, name, data, stored, collections = {}) {
  return checkContent(catalog, name, data, stored, collections).issues;
}

/** The declared collection `key` as read for `name`'s check, null when it was not read; throws for one `name` does not declare. */
function collectionOf(entry, { name, collections = {} }, key) {
  if (!(entry.collections ?? []).includes(key)) throw new Error(`${name} reads the collection "${key}", which its catalog entry does not declare`);
  return collections[key] ?? null;
}

/**
 * The issues of `parsed` as `name`'s content after its schema: its own, then its outgoing and incoming references,
 * as `{ issues, warnings }`.
 */
function contentIssues(catalog, entry, context) {
  const storedOfContext = (other) => storedOf(catalog, context, other);
  const collectionOfContext = (key) => collectionOf(entry, context, key);
  const own = entry.issuesOf
    ? entry.issuesOf(context.parsed, { storedOf: storedOfContext, collectionOf: collectionOfContext }).map((issue) => ({ dataset: context.name, ...issue }))
    : [];
  const found = [...own, ...outgoingIssues(catalog, context), ...incomingIssues(catalog, context), ...recheckIssues(catalog, context)];
  return { issues: onePerPath(found.filter((issue) => !issue.warning)), warnings: found.filter((issue) => issue.warning) };
}

function duplicateKeyIssues(name, parsed) {
  const filesByKey = new Map();
  parsed.forEach(({ key, file }) => filesByKey.set(key, [...(filesByKey.get(key) ?? []), file]));
  return [...filesByKey]
    .filter(([, files]) => files.length > 1)
    .map(([key, files]) => ({ dataset: name, path: [key], message: `key "${key}" is in more than one part: ${files.join(", ")}` }));
}

/** Each part's schema issues, the path opening with its file. */
function partSchemaIssues(name, results) {
  return results.flatMap(({ file, result }) =>
    result.success ? [] : result.error.issues.map((issue) => ({ dataset: name, path: [file, ...issue.path], message: issue.message })),
  );
}

/**
 * A parted dataset's parts, `files` as `{ file, data }`: each runs the part schema (an issue's path opens
 * with its file), each is keyed by `keyOf`, a key may appear once, and the set, ordered by key, runs the
 * dataset's checks as its content. `{ issues, warnings, parts }`, `parts` as `{ key, data, summary }` when
 * there is no issue; a warning keeps the parts.
 */
function checkParts(catalog, name, files, stored, collections = {}) {
  const entry = entryOf(catalog, name);
  const { schema, keyOf, summaryOf } = entry.parts;
  const results = files.map(({ file, data }) => ({ file, result: schema.safeParse(data) }));
  const schemaIssues = partSchemaIssues(name, results);
  if (schemaIssues.length > 0) return { issues: schemaIssues, warnings: [], parts: [] };
  const parsed = results.map(({ file, result }) => ({ file, key: keyOf(result.data), data: result.data }));
  const duplicates = duplicateKeyIssues(name, parsed);
  if (duplicates.length > 0) return { issues: duplicates, warnings: [], parts: [] };
  parsed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const { issues, warnings } = contentIssues(catalog, entry, { name, parsed: parsed.map((part) => part.data), stored, collections });
  return { issues, warnings, parts: issues.length > 0 ? [] : parsed.map(({ key, data }) => ({ key, data, summary: summaryOf(data) })) };
}

/** `manifest` with each stored part's `data` added to its entry; a part not stored keeps none. */
async function withPartData(db, manifest) {
  const { parts } = await readParts(db, manifest);
  const dataById = new Map(parts.map((part) => [part.partId, part.data]));
  return { ...manifest, parts: manifest.parts.map((entry) => (dataById.has(entry.partId) ? { ...entry, data: dataById.get(entry.partId) } : entry)) };
}

/**
 * Every catalog dataset's stored `data`, by name, and its revision, plus the part data of each parted dataset
 * that the checks of `names` read (their entries' `reads`), and of each dataset they recheck and its `reads`. Reads only.
 */
async function readStored(db, catalog, names = []) {
  const docs = await db
    .collection(DATASETS)
    .find({ _id: { $in: Object.keys(catalog.datasets) } }, { projection: { revision: 1, data: 1 } })
    .toArray();
  const stored = Object.fromEntries(docs.map((doc) => [doc._id, doc.data]));
  const recheckers = withRecheckers(catalog, names).filter((name) => !names.includes(name));
  const read = new Set([...recheckers, ...[...names, ...recheckers].flatMap((name) => entryOf(catalog, name).reads ?? [])]);
  for (const name of read) if (stored[name] !== undefined && entryOf(catalog, name).parts) stored[name] = await withPartData(db, stored[name]);
  return { stored, revisions: Object.fromEntries(docs.map((doc) => [doc._id, doc.revision])) };
}

/** Each collection the datasets `names`, and those they recheck, declare, by key, read once through `readCollection(key, spec)`. Reads only. */
async function readCollections(catalog, names, readCollection) {
  const keys = [...new Set(withRecheckers(catalog, names).flatMap((name) => entryOf(catalog, name).collections ?? []))];
  const collections = {};
  for (const key of keys) {
    const spec = catalog.collections?.[key];
    if (!spec) throw new Error(`the catalog declares no collection "${key}"`);
    collections[key] = await readCollection(key, spec);
  }
  return collections;
}

/**
 * A parted dataset's stored `{ issues, warnings }`: checkParts' on the parts its manifest names, or, when one is
 * not stored, each missing part and the schema issues of the others (the set's checks would only repeat the gap).
 * A manifest readStored filled for another dataset's check is not read again.
 */
async function storedPartIssues(db, catalog, name, stored, collections) {
  const isFilled = stored[name].parts.every((entry) => entry.data !== undefined);
  const found = isFilled ? { parts: stored[name].parts, missing: [] } : await readParts(db, stored[name]);
  const files = found.parts.map(({ key, data }) => ({ file: key, data }));
  if (found.missing.length === 0) return checkParts(catalog, name, files, stored, collections);
  const keyById = new Map(stored[name].parts.map((entry) => [entry.partId, entry.key]));
  const missing = found.missing.map((partId) => ({ dataset: name, path: [keyById.get(partId)], message: `part ${partId} is not stored` }));
  const { schema } = entryOf(catalog, name).parts;
  return { issues: [...missing, ...partSchemaIssues(name, files.map(({ file, data }) => ({ file, result: schema.safeParse(data) })))], warnings: [] };
}

/**
 * `check`: the issues of the stored data of `names`, and `warnings` when there is one; a parted dataset's parts
 * are read by the ids its header names, and the collections the stored ones declare through `readCollection`
 * (none without it). Writes nothing.
 */
async function checkStored(db, catalog, names, readCollection) {
  names.forEach((name) => entryOf(catalog, name));
  const { stored, revisions } = await readStored(db, catalog, names);
  const present = names.filter((name) => stored[name] !== undefined);
  const collections = readCollection ? await readCollections(catalog, present, readCollection) : {};
  const [issues, warnings] = [[], []];
  for (const name of present) {
    const found = entryOf(catalog, name).parts
      ? await storedPartIssues(db, catalog, name, stored, collections)
      : checkContent(catalog, name, stored[name], stored, collections);
    issues.push(...found.issues);
    warnings.push(...found.warnings);
  }
  return {
    checked: present.map((dataset) => ({ dataset, revision: revisions[dataset] })),
    missing: names.filter((name) => stored[name] === undefined),
    issues: onePerPath(issues),
    ...(warnings.length > 0 && { warnings }),
  };
}

module.exports = { checkContent, checkData, checkParts, checkStored, readCollections, readStored };
