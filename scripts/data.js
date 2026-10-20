#!/usr/bin/env node
/**
 * `npm run data`: the one tool that edits runtime datasets in the content
 * database (openspec/changes/archive/2026-10-19-move-runtime-data-to-db; how-to:
 * docs/how-to/edit-runtime-data.md). The server only reads them.
 *
 * Usage (npm run data -- <command> ...):
 *   pull <dataset>                        write .data/<dev|prod>/<dataset>.json, or
 *                                         .data/<dev|prod>/<dataset>/ for a parted dataset
 *   push <dataset> [--file <working file> | --dir <working dir>]
 *                                         store the edited working file or directory
 *   push <dataset> --create --file <json> store revision 1 from a plain JSON file
 *   push <dataset> --create --dir <dir>   store revision 1 of a parted dataset from a
 *                                         directory of part files
 *   history <dataset> [--limit <n>]       list stored revisions, newest first
 *   rollback <dataset> <revision>         store an earlier revision as a new one
 *   copy-prod-to-dev <dataset>            store production's data as a new _dev revision
 *   check [<dataset>]                     run the push checks on stored data; writes nothing
 *
 *   --prod      target the production database (default: the _dev one)
 *   --yes       confirm a production write without a terminal prompt
 *   --dry-run   print the target and the diff, write nothing
 *   --note <t>  stored with the revision
 *   --by <who>  the author (default: git config user.email)
 *
 * This file is the command-line surface only: arguments, the target, the
 * confirmation, printing and exit codes (0 done or no change, 1 refused, 2
 * usage). A check's warning is printed with the diff or by `check` and leaves
 * the exit code at 0. The datasets and their validation are scripts/lib/datasets/catalog.js
 * over the compiled dist/src (so `npm run data` builds first), the checks
 * checks.js, the MongoDB protocol store.js (and parts.js for a parted
 * dataset), the pulled file working-file.js (working-dir.js).
 *
 * Why --prod and not NODE_ENV: as scripts/set-campus-schedule.js says, an env
 * var is silently lost when a command is pasted across two lines; a flag cannot
 * be dropped without dropping the word next to it.
 *
 * MONGO_URL is never printed, in part or whole: every line this tool prints
 * passes through a redactor of its credentials, its hosts (with mongodb+srv,
 * every host of the cluster domain) and any IPv4 address, and an error prints
 * only its class and redacted message, never a stack.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { isDeepStrictEqual } = require("node:util");
const { MongoClient } = require("mongodb");

const { loadCatalog } = require("./lib/datasets/catalog");
const { checkContent, checkParts, checkStored, readStored } = require("./lib/datasets/checks");
const parts = require("./lib/datasets/parts");
const store = require("./lib/datasets/store");
const { readPartFiles, readWorkingDir, workingDirPath, writeWorking, writeWorkingDir } = require("./lib/datasets/working-dir");
const { readWorkingFile, workingFilePath, writeWorkingFile } = require("./lib/datasets/working-file");

const REPO_ROOT = path.join(__dirname, "..");
const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const DIFF_LINE_LIMIT = 200;
const SHOWN_VALUE_LIMIT = 160;
const SERVER_SELECTION_TIMEOUT_MS = 10_000;

const USAGE = [
  "usage: npm run data -- <command> [<dataset>] [options]",
  "  pull <dataset> | push <dataset> [--file f | --dir d] | push <dataset> --create (--file f | --dir d)",
  "  history <dataset> [--limit n] | rollback <dataset> <revision>",
  "  copy-prod-to-dev <dataset> | check [<dataset>]",
  "  options: --prod --yes --dry-run --note <text> --by <email>",
].join("\n");

const NEEDS_DATASET = new Set(["pull", "push", "history", "rollback", "copy-prod-to-dev"]);
const COMMANDS = new Set([...NEEDS_DATASET, "check"]);
const FLAGS = { "--prod": "prod", "--yes": "yes", "--dry-run": "dryRun", "--create": "create" };
const VALUED = { "--file": "file", "--dir": "dir", "--note": "note", "--by": "by", "--limit": "limit" };

class UsageError extends Error {}
class Refusal extends Error {}

function parseArgs(argv) {
  const args = { prod: false, yes: false, dryRun: false, create: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAGS[arg]) {
      args[FLAGS[arg]] = true;
    } else if (VALUED[arg]) {
      i += 1;
      if (argv[i] === undefined) throw new UsageError(`${arg} needs a value`);
      args[VALUED[arg]] = argv[i];
    } else if (arg.startsWith("--")) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      args.positional.push(arg);
    }
  }
  const [command, dataset, revision, ...rest] = args.positional;
  if (!COMMANDS.has(command)) throw new UsageError(command ? `unknown command "${command}"` : "no command");
  if (NEEDS_DATASET.has(command) && !dataset) throw new UsageError(`${command} needs a dataset`);
  if (rest.length > 0 || (revision !== undefined && command !== "rollback")) throw new UsageError("too many arguments");
  if (command === "rollback" && !/^[1-9]\d*$/.test(revision ?? "")) throw new UsageError("rollback needs a revision number");
  if (args.create && (command !== "push" || !(args.file || args.dir))) throw new UsageError("--create goes with push and --file <json> or --dir <dir>");
  if (args.file && args.dir) throw new UsageError("pass --file or --dir, not both");
  if (command === "copy-prod-to-dev" && args.prod) {
    throw new UsageError("copy-prod-to-dev writes only the _dev database; drop --prod (nothing copies into production)");
  }
  if (args.limit !== undefined && !/^[1-9]\d*$/.test(args.limit)) throw new UsageError("--limit needs a positive number");
  return { ...args, command, dataset, revision: revision && Number(revision), limit: args.limit && Number(args.limit) };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;

/**
 * Replaces MONGO_URL, its credentials, its hosts and any IPv4 address in any
 * text. With mongodb+srv, every host under the SRV host's parent domain too:
 * the driver's errors name the replica hosts the SRV record resolved to. The
 * user name is redacted only as `user:` or `user@`, so a database name that
 * contains it still prints whole.
 */
function redactorFor(url) {
  const secrets = new Set();
  const patterns = [];
  const match = /^mongodb(\+srv)?:\/\/(?:([^@/]*)@)?([^/?#]*)/.exec(url ?? "");
  if (url) secrets.add(url);
  if (match) {
    const decoded = (part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    };
    const [user = "", ...passwordParts] = (match[2] ?? "").split(":");
    for (const name of new Set([user, decoded(user)].filter(Boolean))) {
      patterns.push(new RegExp(`${escapeRegExp(name)}(?=[:@])`, "g"));
    }
    for (const part of [passwordParts.join(":"), ...passwordParts]) [part, decoded(part)].forEach((each) => secrets.add(each));
    for (const host of match[3].split(",")) {
      secrets.add(host);
      secrets.add(host.replace(/:[^:]*$/, ""));
    }
    const parent = match[1] ? match[3].replace(/:[^:]*$/, "").split(".").slice(1).join(".") : "";
    if (parent.includes(".")) patterns.push(new RegExp(`(?:[A-Za-z0-9-]+\\.)*${escapeRegExp(parent)}(?::\\d+)?`, "gi"));
  }
  const ordered = [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text);
    for (const secret of ordered) out = out.split(secret).join("<redacted>");
    for (const pattern of patterns) out = out.replace(pattern, "<redacted>");
    return out.replace(IPV4, "<redacted>").replace(/mongodb(?:\+srv)?:\/\/\S*/g, "mongodb://<redacted>");
  };
}

function distLoader(root) {
  const base = path.join(root, "dist", "src");
  if (!fs.existsSync(base)) {
    throw new Refusal(`${path.relative(process.cwd(), base) || base} is missing: run \`npm run build\` first (\`npm run data\` builds before it runs).`);
  }
  return (relativePath) => require(path.join(base, relativePath));
}

function databaseNames(env) {
  const base = env.MONGO_CONTENT_DB_NAME;
  if (!base) throw new Refusal("MONGO_CONTENT_DB_NAME is not set in .env (run `npm run env:pull`).");
  return { prod: base, dev: `${base}_dev` };
}

const iso = (value) => (value instanceof Date ? value.toISOString() : String(value));

function show(value) {
  const text = value === undefined ? "(none)" : JSON.stringify(value);
  return text.length > SHOWN_VALUE_LIMIT ? `${text.slice(0, SHOWN_VALUE_LIMIT - 3)}...` : text;
}

const isContainer = (value) => value !== null && typeof value === "object";

/** One line per changed path: `~ a.b: x -> y`, `+ a.c: z`, `- a.d: w`. */
function diffLines(before, after, at = "") {
  if (isDeepStrictEqual(before, after)) return [];
  if (!isContainer(before) || !isContainer(after) || Array.isArray(before) !== Array.isArray(after)) {
    return [`~ ${at || "(root)"}: ${show(before)} -> ${show(after)}`];
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.flatMap((key) => {
    const where = at === "" ? key : `${at}.${key}`;
    if (!(key in after)) return [`- ${where}: ${show(before[key])}`];
    if (!(key in before)) return [`+ ${where}: ${show(after[key])}`];
    return diffLines(before[key], after[key], where);
  });
}

function describeEntry(entry) {
  if (entry.command === "rollback") return `rollback to ${entry.rolledBackTo}`;
  if (entry.command === "copy-prod-to-dev") return `copy-prod-to-dev from ${entry.copiedFrom.database}@${entry.copiedFrom.revision}`;
  return entry.command;
}

function gitEmail() {
  try {
    return execFileSync("git", ["config", "user.email"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function askOnTerminal(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function refusalOf(result, ctx, base) {
  const { dataset } = ctx.args;
  if (result.reason === "conflict") {
    const { revision, updatedBy, updatedAt } = result.current;
    return new Refusal(
      `CONFLICT: ${dataset} is at revision ${revision}, stored by ${updatedBy} at ${iso(updatedAt)}; ` +
        `this edit is based on revision ${base}. Nothing written. Pull again, redo the edit, then push.`,
    );
  }
  if (result.reason === "exists") {
    const { revision, updatedBy, updatedAt } = result.current;
    return new Refusal(
      `${dataset} already exists in ${ctx.dbName} at revision ${revision} (${updatedBy}, ${iso(updatedAt)}). ` +
        "Nothing written. Pull it and push without --create.",
    );
  }
  if (result.reason === "source-moved") {
    const { revision, updatedBy, updatedAt } = result.current;
    return new Refusal(
      `${ctx.names.prod} moved to revision ${revision} (${updatedBy}, ${iso(updatedAt)}) after revision ${result.checked} was checked. ` +
        "Nothing written. Run copy-prod-to-dev again.",
    );
  }
  if (result.reason === "collision") {
    return new Refusal(
      `part ${result.partId} is stored with different content under the same id (a sha256 prefix collision). ` +
        `${dataset}'s header was not written; report this, nothing is overwritten.`,
    );
  }
  if (result.reason === "missing-parts") {
    return new Refusal(`${dataset}: ${result.partIds.length} part(s) the revision names are not stored: ${result.partIds.join(", ")}. Nothing written.`);
  }
  if (result.reason === "pruned") return new Refusal(`revision ${ctx.args.revision} was pruned; the oldest kept is ${result.oldestKept}.`);
  if (result.reason === "no-revision") return new Refusal(`${dataset} has no revision ${ctx.args.revision}.`);
  const source = isParted(ctx) ? "--dir <dir>" : "--file <json>";
  return new Refusal(`${dataset}: no dataset in ${ctx.dbName}. Create it with \`push ${dataset} --create ${source}\`.`);
}

const issueLine = (issue) => `${issue.dataset}  ${issue.path.join(".") || "(root)"}  ${issue.message}`;

function refuseIssues(issues) {
  return new Refusal([`REFUSED: ${issues.length} issue(s), nothing written:`, ...issues.map((issue) => `  ${issueLine(issue)}`)].join("\n"));
}

/** Prints each warning: a check's finding that refuses nothing. */
function printWarnings(ctx, warnings) {
  if (warnings.length === 0) return;
  ctx.out(`${warnings.length} warning(s), not refused:`);
  warnings.forEach((warning) => ctx.out(`  warning  ${issueLine(warning)}`));
}

const isParted = (ctx) => Boolean(ctx.catalog.datasets[ctx.args.dataset].parts);

/** True when production is written only after the operator confirms at the prompt. */
const confirmsAtPrompt = (args) => args.prod && !args.yes;

async function repair(ctx, db, dataset) {
  const result = await store.repair(db, dataset);
  if (result.repaired) {
    ctx.out(`repaired: ${dataset} revision ${result.revision} had no history entry; recorded it from the stored dataset.`);
  }
}

/**
 * The repair of design D4, or a note for a run that writes nothing before a
 * confirmation: `--dry-run`, `check`, and `--prod` without `--yes`, whose
 * confirmed write repairs first (confirmAndWrite).
 */
async function repairOrReport(ctx, db, dataset) {
  if (ctx.args.dryRun || ctx.args.command === "check" || confirmsAtPrompt(ctx.args)) {
    const revision = await store.findUnrecorded(db, dataset);
    if (revision !== null) {
      ctx.out(`note: ${dataset} revision ${revision} has no history entry (a write stopped after storing it); the next write records it.`);
    }
    return;
  }
  await repair(ctx, db, dataset);
}

/** Prints the diff (or a parted dataset's report, `lines`) and the checks' warnings, then writes after the confirmation production needs. */
async function confirmAndWrite(ctx, { before, after, lines: report, summary, warnings = [], write }) {
  const lines = report ?? (before === null ? [`+ ${summary}: ${JSON.stringify(after).length} bytes of JSON`] : diffLines(before, after));
  ctx.out(`diff of ${ctx.args.dataset} (${summary}):`);
  lines.slice(0, DIFF_LINE_LIMIT).forEach((line) => ctx.out(`  ${line}`));
  if (lines.length > DIFF_LINE_LIMIT) ctx.out(`  ... ${lines.length - DIFF_LINE_LIMIT} more changed paths`);
  printWarnings(ctx, warnings);
  if (ctx.args.dryRun) {
    ctx.out("[dry run] nothing written.");
    return null;
  }
  const by = ctx.args.by ?? ctx.whoami();
  if (!by) throw new Refusal("no author: pass --by <email> or set `git config user.email`.");
  if (ctx.args.prod && !ctx.args.yes) {
    if (!ctx.isTTY) throw new Refusal(`refusing to write ${ctx.dbName} (PRODUCTION) without a confirmation: run it in a terminal, or pass --yes.`);
    const answer = await ctx.ask(`write ${summary} to ${ctx.dbName} (PRODUCTION)? type y to confirm: `);
    if (answer.trim() !== "y") throw new Refusal("not confirmed; nothing written.");
  }
  if (confirmsAtPrompt(ctx.args)) await repair(ctx, ctx.db, ctx.args.dataset);
  return write({ by, now: ctx.now(), note: ctx.args.note });
}

function reportStored(ctx, result, base) {
  if (!result.ok) throw refusalOf(result, ctx, base);
  ctx.out(`stored ${ctx.args.dataset} revision ${result.revision} in ${ctx.dbName}.`);
  if (result.garbageError) ctx.out(`warning: the garbage collection after the write failed (${result.garbageError}); the next write collects its parts.`);
  ctx.out("Every api replica that serves it reads it within 60 s, with no restart.");
}

/** `data`'s warnings, or a refusal listing every issue. */
async function checkedWarnings(ctx, db, data) {
  const { stored } = await readStored(db, ctx.catalog);
  const { issues, warnings } = checkContent(ctx.catalog, ctx.args.dataset, data, stored);
  if (issues.length > 0) throw refuseIssues(issues);
  return warnings;
}

async function pull(ctx) {
  const { dataset } = ctx.args;
  await repairOrReport(ctx, ctx.db, dataset);
  const current = await store.readDataset(ctx.db, dataset);
  if (current === null) throw refusalOf({ reason: "missing" }, ctx);
  if (isParted(ctx)) return pullParts(ctx, current);
  const file = workingFilePath(ctx.root, ctx.target, dataset);
  writeWorkingFile(file, { dataset, target: ctx.target, baseRevision: current.revision, pulledAt: iso(ctx.now()), data: current.data });
  ctx.out(`pulled ${dataset} revision ${current.revision} (${current.updatedBy}, ${iso(current.updatedAt)})`);
  ctx.out(`working file  ${path.relative(process.cwd(), file)}`);
  return EXIT_OK;
}

async function create(ctx) {
  const { dataset, file } = ctx.args;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Refusal(`cannot read ${file} as JSON: ${err.message}`, { cause: err });
  }
  const current = await store.readDataset(ctx.db, dataset);
  if (current !== null) throw refusalOf({ reason: "exists", current }, ctx);
  const warnings = await checkedWarnings(ctx, ctx.db, data);
  const result = await confirmAndWrite(ctx, {
    before: null,
    after: data,
    summary: "new dataset, revision 1",
    warnings,
    write: (meta) => store.create(ctx.db, dataset, data, meta),
  });
  if (result !== null) reportStored(ctx, result, null);
  return EXIT_OK;
}

/** Refuses a working file or directory at `where` that holds another dataset or was pulled from the other target. */
function refuseUntargeted(ctx, where, working) {
  const { dataset } = ctx.args;
  const shown = path.relative(process.cwd(), where);
  if (working.dataset !== dataset) throw new Refusal(`${shown} holds ${working.dataset}, not ${dataset}.`);
  if (working.target === ctx.target) return;
  const from = working.target === "dev" ? "development" : "production";
  throw new Refusal(
    `${shown} was pulled from the ${from} database, so it cannot be pushed to ${ctx.dbName}. ` +
      `Pull from ${ctx.target === "prod" ? "production with --prod" : "_dev"} and redo the edit there.`,
  );
}

/** Rethrows what a reader of the working file or directory threw as a refusal. */
function refusingOnError(read) {
  try {
    return read();
  } catch (err) {
    throw new Refusal(err.message, { cause: err });
  }
}

function readTargetedFile(ctx) {
  const file = ctx.args.file ?? workingFilePath(ctx.root, ctx.target, ctx.args.dataset);
  const working = refusingOnError(() => readWorkingFile(file));
  refuseUntargeted(ctx, file, working);
  return { file, working };
}

async function push(ctx) {
  if (isParted(ctx)) return ctx.args.create ? createParts(ctx) : pushParts(ctx);
  if (ctx.args.create) return create(ctx);
  const { dataset } = ctx.args;
  const { file, working } = readTargetedFile(ctx);
  await repairOrReport(ctx, ctx.db, dataset);
  const current = await store.readDataset(ctx.db, dataset);
  if (current === null) throw refusalOf({ reason: "missing" }, ctx);
  if (isDeepStrictEqual(current.data, working.data)) {
    ctx.out(`no change: the file's data equals ${dataset} revision ${current.revision}; nothing written.`);
    return EXIT_OK;
  }
  if (current.revision !== working.baseRevision) throw refusalOf({ reason: "conflict", current }, ctx, working.baseRevision);
  const warnings = await checkedWarnings(ctx, ctx.db, working.data);
  const result = await confirmAndWrite(ctx, {
    before: current.data,
    after: working.data,
    summary: `revision ${current.revision} -> ${current.revision + 1}`,
    warnings,
    write: (meta) => store.push(ctx.db, dataset, working.data, { ...meta, baseRevision: working.baseRevision }),
  });
  if (result === null) return EXIT_OK;
  reportStored(ctx, result, working.baseRevision);
  writeWorkingFile(file, { ...working, baseRevision: result.revision, pulledAt: iso(ctx.now()) });
  return EXIT_OK;
}

/**
 * One line per key of either manifest: `unchanged`, `changed` with its summary's differences (and, from
 * `changesByKey`, what the catalog's `changesOf` read between the stored and the pushed part), `added` or `removed`.
 */
function partReport(before, after, changesByKey = new Map()) {
  const beforeByKey = new Map((before?.parts ?? []).map((entry) => [entry.key, entry]));
  const afterByKey = new Map(after.parts.map((entry) => [entry.key, entry]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();
  return keys.map((key) => {
    const [was, is] = [beforeByKey.get(key), afterByKey.get(key)];
    if (is === undefined) return `removed    ${key}  ${show(was.summary)}`;
    if (was === undefined) return `added      ${key}  ${show(is.summary)}`;
    if (was.partId === is.partId) return `unchanged  ${key}`;
    const differences = diffLines(was.summary, is.summary).map((line) => line.slice(2));
    const described = [differences.length > 0 ? differences.join("; ") : "same summary, other content", ...(changesByKey.get(key) ?? [])];
    return `changed    ${key}  ${described.join("; ")}`;
  });
}

const partIdLines = (manifest) => manifest.parts.map((entry) => `${entry.key} ${entry.partId}`).join("\n");
const samePartIds = (before, after) => partIdLines(before) === partIdLines(after);

/** The checked parts of `files`, their manifest and the checks' warnings, or a refusal listing every issue. */
async function checkedParts(ctx, files) {
  const { stored } = await readStored(ctx.db, ctx.catalog);
  const checked = checkParts(ctx.catalog, ctx.args.dataset, files, stored);
  if (checked.issues.length > 0) throw refuseIssues(checked.issues);
  const manifest = parts.toManifest(checked.parts.map((part) => parts.toStoredPart(ctx.args.dataset, part)));
  return { parts: checked.parts, manifest, warnings: checked.warnings };
}

/** The parts `manifest` names, or a refusal naming every one that is not stored. */
async function readNamedParts(ctx, db, manifest, revision) {
  const found = await parts.readParts(db, manifest);
  if (found.missing.length > 0) {
    throw new Refusal(`${ctx.args.dataset} revision ${revision} names ${found.missing.length} part(s) not stored in ${db.databaseName}: ${found.missing.join(", ")}`);
  }
  return found.parts;
}

/**
 * By changed key, the catalog's `changesOf(stored, pushed)` over the parsed parts; none when the catalog has no
 * `changesOf`. A stored part this checkout's schema rejects gets a line saying so, and the push goes on.
 */
async function partChanges(ctx, current, checked) {
  const { schema, changesOf } = ctx.catalog.datasets[ctx.args.dataset].parts;
  if (!changesOf) return new Map();
  const pushedIds = new Map(checked.manifest.parts.map((entry) => [entry.key, entry.partId]));
  const changed = current.data.parts.filter((entry) => pushedIds.has(entry.key) && pushedIds.get(entry.key) !== entry.partId);
  const { parts: stored } = await parts.readParts(ctx.db, { parts: changed });
  const pushedByKey = new Map(checked.parts.map((part) => [part.key, part.data]));
  return new Map(
    stored.map(({ key, data }) => {
      const parsed = schema.safeParse(data);
      return [key, parsed.success ? changesOf(parsed.data, pushedByKey.get(key)) : ["stored part fails this checkout's schema"]];
    }),
  );
}

async function pullParts(ctx, current) {
  const { dataset } = ctx.args;
  const named = await readNamedParts(ctx, ctx.db, current.data, current.revision);
  const dir = workingDirPath(ctx.root, ctx.target, dataset);
  writeWorkingDir(dir, { dataset, target: ctx.target, baseRevision: current.revision, pulledAt: iso(ctx.now()), manifest: current.data }, named);
  ctx.out(`pulled ${dataset} revision ${current.revision} (${current.updatedBy}, ${iso(current.updatedAt)}), ${named.length} part(s)`);
  ctx.out(`working directory  ${path.relative(process.cwd(), dir)}`);
  return EXIT_OK;
}

async function createParts(ctx) {
  const { dataset } = ctx.args;
  const files = refusingOnError(() => readPartFiles(ctx.args.dir));
  const current = await store.readDataset(ctx.db, dataset);
  if (current !== null) throw refusalOf({ reason: "exists", current }, ctx);
  const checked = await checkedParts(ctx, files);
  const result = await confirmAndWrite(ctx, {
    lines: partReport(null, checked.manifest),
    summary: `new dataset of ${checked.parts.length} part(s), revision 1`,
    warnings: checked.warnings,
    write: (meta) => parts.create(ctx.db, dataset, checked.parts, meta),
  });
  if (result !== null) reportStored(ctx, result, null);
  return EXIT_OK;
}

async function pushParts(ctx) {
  const { dataset } = ctx.args;
  const dir = ctx.args.dir ?? workingDirPath(ctx.root, ctx.target, dataset);
  const { working, files } = refusingOnError(() => readWorkingDir(dir));
  refuseUntargeted(ctx, dir, working);
  await repairOrReport(ctx, ctx.db, dataset);
  const current = await store.readDataset(ctx.db, dataset);
  if (current === null) throw refusalOf({ reason: "missing" }, ctx);
  const checked = await checkedParts(ctx, files);
  if (samePartIds(current.data, checked.manifest)) {
    const { missing } = await parts.readParts(ctx.db, current.data);
    if (missing.length > 0) return restoreParts(ctx, current, checked, missing);
    ctx.out(`no change: every part equals ${dataset} revision ${current.revision}; nothing written.`);
    return EXIT_OK;
  }
  if (current.revision !== working.baseRevision) throw refusalOf({ reason: "conflict", current }, ctx, working.baseRevision);
  const result = await confirmAndWrite(ctx, {
    lines: partReport(current.data, checked.manifest, await partChanges(ctx, current, checked)),
    summary: `revision ${current.revision} -> ${current.revision + 1}`,
    warnings: checked.warnings,
    write: (meta) => parts.push(ctx.db, dataset, checked.parts, { ...meta, baseRevision: working.baseRevision }),
  });
  if (result === null) return EXIT_OK;
  reportStored(ctx, result, working.baseRevision);
  writeWorking(dir, { ...working, baseRevision: result.revision, pulledAt: iso(ctx.now()), manifest: checked.manifest });
  return EXIT_OK;
}

/** Stores again the parts the current revision names and the directory holds unchanged, when some are missing; the header stays. */
async function restoreParts(ctx, current, checked, missing) {
  const { dataset } = ctx.args;
  const keyById = new Map(current.data.parts.map((entry) => [entry.partId, entry.key]));
  const result = await confirmAndWrite(ctx, {
    lines: missing.map((partId) => `missing    ${keyById.get(partId)}  ${partId}`),
    summary: `revision ${current.revision} unchanged, ${missing.length} missing part(s) stored again`,
    warnings: checked.warnings,
    write: (meta) => parts.restore(ctx.db, dataset, checked.parts, meta),
  });
  if (result === null) return EXIT_OK;
  if (!result.ok) throw refusalOf(result, ctx);
  ctx.out(`restored ${missing.length} part(s) of ${dataset} revision ${current.revision} in ${ctx.dbName}; the revision is unchanged.`);
  return EXIT_OK;
}

/** The parts a stored manifest names, checked as a push checks them; refuses one that is missing. */
async function checkedNamedParts(ctx, db, manifest, revision) {
  const named = await readNamedParts(ctx, db, manifest, revision);
  return checkedParts(
    ctx,
    named.map(({ key, data }) => ({ file: key, data })),
  );
}

async function rollbackParts(ctx, current, entry) {
  const { dataset, revision } = ctx.args;
  if (samePartIds(current.data, entry.data)) {
    ctx.out(`no change: revision ${revision} names the parts of the current revision ${current.revision}; nothing written.`);
    return EXIT_OK;
  }
  const { warnings } = await checkedNamedParts(ctx, ctx.db, entry.data, revision);
  const result = await confirmAndWrite(ctx, {
    lines: partReport(current.data, entry.data),
    summary: `revision ${current.revision} -> ${current.revision + 1}, the parts of revision ${revision}`,
    warnings,
    write: (meta) => parts.rollback(ctx.db, dataset, revision, { ...meta, baseRevision: current.revision }),
  });
  if (result !== null) reportStored(ctx, result, current.revision);
  return EXIT_OK;
}

async function copyPartsToDev(ctx, prod, source, current) {
  const { dataset } = ctx.args;
  if (current !== null && samePartIds(current.data, source.data)) {
    ctx.out(`no change: ${ctx.dbName} revision ${current.revision} already names production revision ${source.revision}'s parts.`);
    return EXIT_OK;
  }
  const { warnings } = await checkedNamedParts(ctx, prod, source.data, source.revision);
  const base = current === null ? null : current.revision;
  const result = await confirmAndWrite(ctx, {
    lines: partReport(current === null ? null : current.data, source.data),
    summary: `production revision ${source.revision} into ${base === null ? "a new dataset" : `revision ${base + 1}`}`,
    warnings,
    write: (meta) => parts.copy(prod, ctx.db, dataset, { ...meta, sourceRevision: source.revision, baseRevision: base }),
  });
  if (result !== null) reportStored(ctx, result, base);
  return EXIT_OK;
}

async function history(ctx) {
  const { dataset } = ctx.args;
  await repairOrReport(ctx, ctx.db, dataset);
  const current = await store.readDataset(ctx.db, dataset);
  if (current === null) {
    ctx.out(`${dataset}: no dataset yet in ${ctx.dbName}.`);
    return EXIT_OK;
  }
  const entries = await store.history(ctx.db, dataset, { limit: ctx.args.limit });
  for (const entry of entries) {
    const note = entry.note === undefined ? "" : `  "${entry.note}"`;
    const marker = entry.revision === current.revision ? "  <- current" : "";
    ctx.out(`${String(entry.revision).padStart(5)}  ${iso(entry.savedAt)}  ${entry.savedBy}  ${describeEntry(entry)}${note}${marker}`);
    if (isParted(ctx)) entry.data.parts.forEach(({ key, summary }) => ctx.out(`         ${key}  ${show(summary)}`));
  }
  return EXIT_OK;
}

async function rollback(ctx) {
  const { dataset, revision } = ctx.args;
  await repairOrReport(ctx, ctx.db, dataset);
  const current = await store.readDataset(ctx.db, dataset);
  if (current === null) throw refusalOf({ reason: "missing" }, ctx);
  const found = await store.readRevision(ctx.db, dataset, revision);
  if (!found.ok) throw refusalOf(found, ctx);
  if (isParted(ctx)) return rollbackParts(ctx, current, found.entry);
  if (isDeepStrictEqual(current.data, found.entry.data)) {
    ctx.out(`no change: revision ${revision}'s data equals the current revision ${current.revision}; nothing written.`);
    return EXIT_OK;
  }
  const warnings = await checkedWarnings(ctx, ctx.db, found.entry.data);
  const result = await confirmAndWrite(ctx, {
    before: current.data,
    after: found.entry.data,
    summary: `revision ${current.revision} -> ${current.revision + 1}, the data of revision ${revision}`,
    warnings,
    write: (meta) => store.rollback(ctx.db, dataset, revision, { ...meta, baseRevision: current.revision }),
  });
  if (result !== null) reportStored(ctx, result, current.revision);
  return EXIT_OK;
}

async function copyProdToDev(ctx) {
  const { dataset } = ctx.args;
  const prod = ctx.client.db(ctx.names.prod);
  ctx.out(`from       ${ctx.names.prod}   (production, read only)`);
  await repairOrReport(ctx, ctx.db, dataset);
  const source = await store.readDataset(prod, dataset);
  if (source === null) throw new Refusal(`${dataset}: no dataset in ${ctx.names.prod}; nothing to copy.`);
  const current = await store.readDataset(ctx.db, dataset);
  if (isParted(ctx)) return copyPartsToDev(ctx, prod, source, current);
  if (current !== null && isDeepStrictEqual(current.data, source.data)) {
    ctx.out(`no change: ${ctx.dbName} revision ${current.revision} already holds production revision ${source.revision}'s data.`);
    return EXIT_OK;
  }
  const warnings = await checkedWarnings(ctx, ctx.db, source.data);
  const base = current === null ? null : current.revision;
  const result = await confirmAndWrite(ctx, {
    before: current === null ? null : current.data,
    after: source.data,
    summary: `production revision ${source.revision} into ${base === null ? "a new dataset" : `revision ${base + 1}`}`,
    warnings,
    write: (meta) => store.copy(prod, ctx.db, dataset, { ...meta, sourceRevision: source.revision, baseRevision: base }),
  });
  if (result !== null) reportStored(ctx, result, base);
  return EXIT_OK;
}

async function check(ctx) {
  const names = ctx.args.dataset ? [ctx.args.dataset] : Object.keys(ctx.catalog.datasets);
  for (const name of names) await repairOrReport(ctx, ctx.db, name);
  const result = await checkStored(ctx.db, ctx.catalog, names);
  result.checked.forEach(({ dataset, revision }) => ctx.out(`checked  ${dataset} revision ${revision}`));
  result.missing.forEach((dataset) => ctx.out(`skipped  ${dataset}: no dataset yet in ${ctx.dbName}`));
  printWarnings(ctx, result.warnings ?? []);
  if (result.issues.length > 0) {
    ctx.err([`FAIL: ${result.issues.length} issue(s) in stored data:`, ...result.issues.map((issue) => `  ${issueLine(issue)}`)].join("\n"));
    return EXIT_REFUSED;
  }
  ctx.out("OK: the stored data passes every check of this checkout.");
  return EXIT_OK;
}

const HANDLERS = { pull, push, history, rollback, "copy-prod-to-dev": copyProdToDev, check };

async function connectAndRun(ctx, url, serverSelectionTimeoutMS) {
  const client = new MongoClient(url, { serverSelectionTimeoutMS });
  try {
    await client.connect();
    return await HANDLERS[ctx.args.command]({ ...ctx, client, db: client.db(ctx.dbName) });
  } finally {
    await client.close();
  }
}

/**
 * Runs one command and resolves its exit code. `deps` replaces what the
 * command line takes from the process, for the tests: env, root, load (or a
 * whole catalog), stdout, stderr, isTTY, ask, now, whoami and
 * serverSelectionTimeoutMS.
 */
async function run(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const redact = redactorFor(env.MONGO_URL);
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const out = (line = "") => stdout.write(`${redact(line)}\n`);
  const err = (line = "") => stderr.write(`${redact(line)}\n`);
  try {
    const args = parseArgs(argv);
    const root = deps.root ?? REPO_ROOT;
    const catalog = deps.catalog ?? loadCatalog(deps.load ?? distLoader(root));
    for (const name of [args.dataset].filter(Boolean)) {
      if (!catalog.datasets[name]) throw new UsageError(`unknown dataset "${name}" (known: ${Object.keys(catalog.datasets).join(", ")})`);
      if (catalog.datasets[name].parts && args.file) throw new UsageError(`${name} is stored in parts: push it from a directory with --dir, not --file`);
      if (!catalog.datasets[name].parts && args.dir) throw new UsageError(`${name} is one document: push it with --file, not --dir`);
    }
    const names = databaseNames(env);
    if (!env.MONGO_URL) throw new Refusal("MONGO_URL is not set in .env (run `npm run env:pull`).");
    const target = args.prod ? "prod" : "dev";
    const dbName = names[target];
    out(`database   ${dbName}   ${args.prod ? "<- PRODUCTION" : "(dev; pass --prod for production)"}`);
    const ctx = {
      args,
      catalog,
      names,
      target,
      dbName,
      root,
      out,
      err,
      isTTY: deps.isTTY ?? Boolean(process.stdin.isTTY),
      ask: deps.ask ?? askOnTerminal,
      now: deps.now ?? (() => new Date()),
      whoami: deps.whoami ?? gitEmail,
    };
    return await connectAndRun(ctx, env.MONGO_URL, deps.serverSelectionTimeoutMS ?? SERVER_SELECTION_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`${error.message}\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (error instanceof Refusal) {
      err(error.message);
      return EXIT_REFUSED;
    }
    err(`${error.name}: ${error.message}`);
    return EXIT_REFUSED;
  }
}

if (require.main === module) {
  // Anchored to the repo, not the shell's cwd, as the other scripts do.
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { run };
