#!/usr/bin/env node
/**
 * Write the committed campus shuttle timetable into bus_campus.bus_schedules.
 *
 * The timetable used to live only in MongoDB, and docs/project-docs.md still
 * shows an operator a hand-typed `db.bus_schedules.insertOne(...)` for it. That
 * is how the 2026-1 timetable survived into the 2026-2 semester unnoticed: no
 * file in the repo answered "what is prod supposed to be serving", so nothing
 * could disagree with it. scripts/data/campus-schedule.json is now that file,
 * and this script is the only thing that should write it.
 *
 * Usage:
 *   node scripts/set-campus-schedule.js --dry-run   # print the diff, write nothing
 *   node scripts/set-campus-schedule.js --check     # exit 1 if the DB differs
 *   node scripts/set-campus-schedule.js             # write to bus_campus_dev
 *   node scripts/set-campus-schedule.js --prod      # write to bus_campus
 *
 *   --file <path>   default scripts/data/campus-schedule.json
 *                   (scripts/data/commute-schedule.json for 통학셔틀)
 *   --create        insert patterns the database does not have yet
 *
 * ## Why --prod and not NODE_ENV
 *
 * Same reasoning as scripts/eventmap-window.js:19-27. An env var is silently
 * lost the moment a command is pasted across two lines, and the failure is
 * invisible: the script prints a cheerful success for a database nobody meant
 * to touch. A flag cannot be dropped without also dropping the word next to it.
 *
 * ## Why it creates only on request, and refuses overlaps
 *
 * An upsert with a typo'd serviceId or patternId would not fail; it would
 * create an extra pattern document, and if its weekdays and range overlap a
 * real one, two timetables apply to the same dates. ScheduleService then serves
 * the latest effectiveFrom and logs bus.schedule.pattern_conflict, but the
 * rider still sees whichever one wins. So updates use upsert:false, and a
 * matchedCount other than 1 aborts. A new shuttle's first load needs
 * --create, which inserts exactly the documents the file declares and the
 * database lacks; without it a missing document aborts before anything is
 * written.
 *
 * Before writing, every other pattern of the same services is compared with
 * the file (findOverlaps). One that shares a weekday and an overlapping range
 * aborts the run. Patterns that only meet end to end, such as one semester
 * ending 2026-12-18 and the next starting 2026-12-21, are left alone.
 *
 * ## Why it reads the stored bus-stops first
 *
 * Each entry's stopTimes follows its service's stop sequence index for index,
 * and the sequences are the bus-stops dataset's (npm run data). Before
 * anything else, and in --dry-run and --check too, the run reads the target's
 * stored bus-stops (the content database, `_dev` without --prod, as the
 * bus_campus database) and refuses, writing nothing, when an entry's stop
 * times do not fit its sequence (stopTimesMismatches in
 * scripts/lib/campus-schedule-file.js, which `npm run data -- push bus-stops`
 * runs from the other side), or when the file carries stop times and the
 * target stores no bus-stops. A pattern of the file that ended before today
 * (KST) serves no date ahead: it is printed as skipped and not checked, as the
 * other side skips a stored one (splitExpired). It reads the stored
 * `data.sequences` raw: this script runs without dist/. A change to a
 * sequence's length pushes bus-stops with `--against <this file>` first,
 * then runs this at once (docs/how-to/edit-bus-stops.md).
 *
 * NOTE: every process caches a resolved week for one minute and then waits for
 * a reload (WEEK_CACHE_TTL_MS in src/bus/schedule/bus-schedule.service.ts;
 * ADR 0012, D6). So a write reaches every api replica, and the poller's
 * arrival-estimate pollers, within a minute, with no restart. The script says
 * so after every write.
 */
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { MongoClient } = require("mongodb");

const {
  buildDocuments,
  diffEntries,
  diffRange,
  findOverlaps,
  parseTimetableFile,
  splitExpired,
  stopTimesMismatches,
} = require("./lib/campus-schedule-file");

const DEFAULT_FILE = path.join(__dirname, "data", "campus-schedule.json");
const COLLECTION = "bus_schedules";
const DATASETS = "datasets";
const BUS_STOPS = "bus-stops";

function parseArgs(argv) {
  const args = { prod: false, dryRun: false, check: false, create: false, file: DEFAULT_FILE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prod") {
      args.prod = true;
    } else if (arg === "--create") {
      args.create = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--file") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--file requires a path");
      }
      args.file = path.resolve(argv[i]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

/**
 * A database name with the _dev suffixing src/infra/config.ts applies, for the
 * .env name `variable` (MONGO_DB_NAME_BUS_CAMPUS, MONGO_CONTENT_DB_NAME).
 *
 * Duplicated from config.ts rather than imported because scripts are plain
 * CommonJS excluded from tsconfig, and config.ts would process.exit(1) on any
 * unrelated missing env var — an ops script must not depend on the full server
 * config being present. Mirrors scripts/lib/eventmap-db.js:21-30.
 */
function resolveDbName(env, variable, isProd) {
  const base = env[variable];
  if (!base) {
    throw new Error(`${variable} not set in .env`);
  }
  return isProd ? base : `${base}_dev`;
}

/**
 * Every line of the refusal when the file's stop times do not fit the stored
 * sequences, or the file has stop times and no bus-stops is stored; none when
 * the run may go on. A pattern that ended before today (KST) is printed as
 * skipped and not checked (splitExpired). Reads only.
 */
async function stopTimesRefusal(client, contentDbName, target, { log, now }) {
  const stored = await client.db(contentDbName).collection(DATASETS).findOne({ _id: BUS_STOPS }, { projection: { revision: 1, "data.sequences": 1 } });
  const { served, expired } = splitExpired(target, now);
  expired.forEach(({ message }) => log(`skipped    ${message}`));
  const hasStopTimes = served.some((doc) => doc.entries.some((entry) => entry.stopTimes !== undefined));
  if (stored === null) {
    log(`stops      ${contentDbName} has no ${BUS_STOPS}`);
    return hasStopTimes ? [`FAIL: ${BUS_STOPS} is not stored in ${contentDbName}, so the stop times cannot be checked against its sequences; nothing written.`] : [];
  }
  log(`stops      ${contentDbName} ${BUS_STOPS} revision ${stored.revision}`);
  const sequences = stored.data?.sequences;
  if (sequences === null || typeof sequences !== "object") return [`FAIL: ${BUS_STOPS} revision ${stored.revision} in ${contentDbName} holds no sequences; nothing written.`];
  const mismatches = stopTimesMismatches(served, sequences);
  if (mismatches.length === 0) return [];
  return [
    ...mismatches.map((mismatch) => `  MISMATCH ${mismatch.message}`),
    `FAIL: ${mismatches.length} entr${mismatches.length === 1 ? "y does" : "ies do"} not fit the stored ${BUS_STOPS} sequences; nothing written. ` +
      "A sequence-length change pushes bus-stops with --against <this file> first (docs/how-to/edit-bus-stops.md).",
  ];
}

function docKey(doc) {
  return `${doc.serviceId}/${doc.patternId}`;
}

/** Strip _id so a DB document can be deep-compared against a built one. */
function stripId(doc) {
  const { _id, ...rest } = doc;
  void _id;
  return rest;
}

function formatEntry(entry) {
  const notes = entry.notes === null ? "" : `   notes ${JSON.stringify(entry.notes)}`;
  const stops = entry.stopTimes ? `   stops ${entry.stopTimes.map((t) => t ?? "–").join(" ")}` : "";
  return `${entry.time}  ${entry.routeType.padEnd(7)} x${entry.busCount}${notes}${stops}`;
}

function renderDiff(current, target, routeTypes, create) {
  const lines = [];
  const changed = [];
  const missing = [];

  for (const doc of target) {
    const before = current.get(docKey(doc));
    const heading = `${doc.serviceId} / ${doc.patternId}`;

    if (!before) {
      lines.push(
        `  ${heading}   MISSING in database — ${create ? "will be created" : "pass --create to insert it"} (${doc.entries.length} entries)`,
      );
      missing.push(doc);
      continue;
    }

    const daysSame = isDeepStrictEqual(before.days, doc.days);
    const rangeLines = diffRange(before, doc);
    const entryLines = diffEntries(before.entries, doc.entries, routeTypes);

    if (daysSame && rangeLines.length === 0 && entryLines.length === 0) {
      lines.push(`  ${heading}   unchanged (${doc.entries.length} entries)`);
      continue;
    }

    changed.push(doc);
    lines.push(`  ${heading}`);
    if (!daysSame) {
      lines.push(`    days ${JSON.stringify(before.days)} -> ${JSON.stringify(doc.days)}`);
    }
    for (const line of rangeLines) {
      lines.push(`    ${line}`);
    }
    for (const line of entryLines) {
      if (line.kind === "add") {
        lines.push(`    + ${formatEntry(line.entry)}`);
      } else if (line.kind === "remove") {
        lines.push(`    - ${formatEntry(line.entry)}`);
      } else {
        const before1 = `x${line.before.busCount}`;
        const after1 = `x${line.entry.busCount}`;
        const count = before1 === after1 ? after1 : `${before1} -> ${after1}`;
        const notesBefore = line.before.notes ?? null;
        const notesChanged = notesBefore !== line.entry.notes
          ? `   notes ${JSON.stringify(notesBefore)} -> ${JSON.stringify(line.entry.notes)}`
          : "";
        const stopsBefore = JSON.stringify(line.before.stopTimes ?? null);
        const stopsAfter = JSON.stringify(line.entry.stopTimes ?? null);
        const stopsChanged = stopsBefore !== stopsAfter ? `   stopTimes ${stopsBefore} -> ${stopsAfter}` : "";
        lines.push(`    ~ ${line.entry.time}  ${line.entry.routeType.padEnd(7)} ${count}${notesChanged}${stopsChanged}`);
      }
    }
    lines.push(`      ${before.entries.length} entries -> ${doc.entries.length} entries`);
  }

  return { lines, changed, missing };
}

/**
 * Runs one invocation and resolves its exit code (0 done or matching, 1
 * refused or differing). `deps` replaces what it takes from the process, for
 * the tests: env, out, err and now.
 */
async function run(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((line = "") => console.log(line));
  const err = deps.err ?? ((line = "") => console.error(line));
  const now = deps.now ?? (() => new Date());
  try {
    return await apply(parseArgs(argv), env, { out, err, now });
  } catch (error) {
    err(error.message);
    return 1;
  }
}

async function apply(args, env, { out, err, now }) {
  const dbName = resolveDbName(env, "MONGO_DB_NAME_BUS_CAMPUS", args.prod);
  const contentDbName = resolveDbName(env, "MONGO_CONTENT_DB_NAME", args.prod);

  const raw = JSON.parse(fs.readFileSync(args.file, "utf8"));
  const timetable = parseTimetableFile(raw);
  const target = buildDocuments(timetable);
  const serviceIds = [...new Set(target.map((d) => d.serviceId))];

  const until = timetable.effectiveUntil ? ` until ${timetable.effectiveUntil}` : " (no end date)";
  out(`database   ${dbName}${args.prod ? "   <- PRODUCTION" : "   (dev — pass --prod for production)"}`);
  out(`file       ${path.relative(process.cwd(), args.file)}`);
  out(`semester   ${timetable.semester}   effective ${timetable.effectiveFrom}${until}`);
  out();

  const client = new MongoClient(env.MONGO_URL);
  await client.connect();

  try {
    const refusal = await stopTimesRefusal(client, contentDbName, target, { log: out, now: now() });
    if (refusal.length > 0) {
      out();
      refusal.forEach((line) => err(line));
      return 1;
    }
    out();

    const col = client.db(dbName).collection(COLLECTION);
    const existing = await col.find({ serviceId: { $in: serviceIds } }).toArray();
    const current = new Map(existing.map((doc) => [docKey(doc), doc]));

    // Other patterns of these services are allowed — an earlier or later
    // semester — as long as no date is claimed twice (see the header).
    const declared = new Set(target.map(docKey));
    const others = existing.filter((doc) => !declared.has(docKey(doc)));
    const overlaps = findOverlaps(target, others);

    const { lines, changed, missing } = renderDiff(current, target, timetable.routeTypes, args.create);
    lines.forEach((line) => out(line));

    for (const other of others) {
      const range = `${other.effectiveFrom ?? "…"}..${other.effectiveUntil ?? "…"}`;
      out(`  ${docKey(other)}   not in this file (days ${JSON.stringify(other.days)}, ${range})`);
    }

    const differ = changed.length + missing.length;
    out();
    out(
      `${target.length} documents: ${changed.length} differ, ${missing.length} missing, ${target.length - differ} match.` +
        (differ > 0 ? "  index is positional and is reassigned on every written document." : ""),
    );

    if (overlaps.length > 0) {
      for (const { target: doc, other } of overlaps) {
        err(
          `  OVERLAP ${docKey(doc)} (${doc.effectiveFrom}..${doc.effectiveUntil ?? "…"}) and ${docKey(other)} ` +
            `(${other.effectiveFrom ?? "…"}..${other.effectiveUntil ?? "…"}) share a weekday and dates`,
        );
      }
      err(`\nFAIL: ${overlaps.length} overlapping pattern pair(s) — nothing written. Resolve before writing.`);
      return 1;
    }

    if (args.check) {
      if (differ > 0) {
        err("\nFAIL: database does not match the committed timetable.");
        return 1;
      }
      out("\nOK — the database matches the committed timetable.");
      return 0;
    }

    if (args.dryRun) {
      out("\n[DRY RUN] No writes performed. Remove --dry-run to apply.");
      return 0;
    }

    if (missing.length > 0 && !args.create) {
      err(`\nFAIL: ${missing.length} document(s) missing — nothing written. Pass --create to insert them.`);
      return 1;
    }

    if (differ === 0) {
      out("\nNothing to do.");
    } else {
      out();
      for (const doc of missing) {
        // insertOne fails on the unique { serviceId, patternId } index if the
        // document appeared since the read, so --create never overwrites.
        await col.insertOne({ ...doc });
        out(`  created ${docKey(doc)}`);
      }
      for (const doc of changed) {
        // replaceOne, not $set: the committed file is the WHOLE truth of the
        // document, so a field it stops mentioning must disappear rather than
        // linger. upsert:false — see the header.
        const result = await col.replaceOne(
          { serviceId: doc.serviceId, patternId: doc.patternId },
          doc,
          { upsert: false },
        );
        if (result.matchedCount !== 1) {
          throw new Error(
            `${docKey(doc)}: matched ${result.matchedCount} documents, expected exactly 1 — nothing further written`,
          );
        }
        out(`  wrote ${docKey(doc)}  (modified ${result.modifiedCount})`);
      }
    }

    // Read back. modifiedCount says a write was acknowledged; it does not say
    // what the collection now holds, and the two failures this script exists to
    // prevent — writing to the wrong database, and a stray shadowing document —
    // are both invisible to it.
    const after = await col.find({ serviceId: { $in: serviceIds } }).toArray();
    const afterMap = new Map(after.map((doc) => [docKey(doc), stripId(doc)]));

    const drift = target.filter((doc) => !isDeepStrictEqual(afterMap.get(docKey(doc)), doc));
    if (drift.length > 0 || after.length !== target.length + others.length) {
      err(`\nFAIL: read-back mismatch on ${drift.length} document(s).`);
      return 1;
    }

    out(`\nVERIFIED — all ${target.length} documents match the file.`);
    out(
      "The api replicas and the poller's estimate pollers serve this within 1 minute (the schedule cache TTL); " +
        "no restart is needed.",
    );
    return 0;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  // Anchored to the repo, not the shell's cwd — dotenv's default would hand
  // somebody running this from another directory a missing-MONGO_URL error that
  // says nothing about why.
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { run };
