#!/usr/bin/env node
/**
 * Prove that a deploy left the HTTP contract alone: capture what a list of
 * routes returns before the deploy, then diff the same routes after it.
 *
 * Usage:
 *   node scripts/compare-responses.js capture --base <url> --urls <file> --out <snapshot.json> [--lang ko] [--force]
 *   node scripts/compare-responses.js diff --against <snapshot.json> [--base <url>] [--urls <file>] [--mode exact|shape]
 *
 *   --urls     one path per line (`/building/list?campus=hssc`); blank lines and
 *              lines starting with # are skipped. diff defaults to the snapshot's paths.
 *   --base     e.g. https://api.skkuverse.com. diff defaults to the snapshot's base.
 *   --mode     exact (default): bodies must be deep-equal.
 *              shape: only keys and value types must match, for live data. An
 *              array is the union of its elements' shapes, so a list with more or
 *              fewer items of the same shape is equal; `null` is its own type.
 *   --lang     Accept-Language sent with every request (default ko). Stored in
 *              the snapshot; diff always reuses it.
 *   --force    capture only: overwrite an existing snapshot (the "before" one is
 *              what the whole comparison rests on, so this is opt-in).
 *
 * COMPARE_AUTHORIZATION, when set, is sent whole as the Authorization header
 * (e.g. `Bearer <Firebase idToken>` for routes behind auth). Its value is never
 * printed or stored; the snapshot only records that one was used.
 *
 * Per URL this records the status, the headers cache-control, etag, vary and
 * content-type, and the body (parsed when the content-type is JSON, text
 * otherwise). Nothing else is recorded, so X-Response-Time, rate-limit and
 * Cloudflare headers never show up as a difference. Status and the four headers
 * are compared exactly in both modes, except that shape mode checks only that
 * an etag is present, since live data changes it.
 *
 * Exit status: diff exits 1 on any difference and prints a per-URL report.
 *
 * Snapshots hold production data (notices behind auth, too). Write them outside
 * the repository or to a gitignored path; capture refuses a path inside the
 * repository that git does not ignore. Never commit one.
 *
 * Requests are sequential GETs with redirects not followed (a 3xx is part of
 * the contract), one at a time to stay far below the API's rate limit.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_VERSION = 1;
const HEADERS = ["cache-control", "etag", "vary", "content-type"];
const MODES = ["exact", "shape"];
const KIND_ORDER = ["null", "boolean", "number", "string", "object", "array"];
const TIMEOUT_MS = 15000;
const MAX_LINES_PER_URL = 30;
const USER_AGENT = "skkuverse-compare-responses";
const AUTH_ENV = "COMPARE_AUTHORIZATION";

// ── URL list ────────────────────────────────────────────────────────────────

function parseUrlList(text) {
  const paths = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (!line.startsWith("/") || line.startsWith("//")) {
      throw new Error(`URL list line ${i + 1}: "${line}" is not a path on the base URL (start it with a single /)`);
    }
    if (/\s/.test(line)) throw new Error(`URL list line ${i + 1}: "${line}" contains whitespace`);
    if (seen.has(line)) throw new Error(`URL list line ${i + 1}: ${line} is listed twice`);
    seen.add(line);
    paths.push(line);
  });
  if (!paths.length) throw new Error("the URL list has no paths");
  return paths;
}

// ── Recording a response ────────────────────────────────────────────────────

/** The four contract headers from a fetch `Headers` or a plain object; absent is null. */
function pickHeaders(headers) {
  const get =
    typeof headers.get === "function"
      ? (name) => headers.get(name)
      : (name) => {
          const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
          return key === undefined ? null : headers[key];
        };
  const out = {};
  for (const name of HEADERS) {
    const value = get(name);
    out[name] = value == null ? null : String(value);
  }
  return out;
}

function isJsonContentType(contentType) {
  return contentType != null && /^application\/(?:[\w.-]+\+)?json\s*(?:;|$)/i.test(contentType);
}

/** What a snapshot keeps of one response. A JSON content-type with an unparseable body is kept as text. */
function buildRecord({ status, headers, text }) {
  const picked = pickHeaders(headers);
  if (isJsonContentType(picked["content-type"])) {
    try {
      return { status, headers: picked, bodyType: "json", body: JSON.parse(text) };
    } catch {
      // Recorded as text below; a JSON route that stops returning JSON shows up as `bodyType`.
    }
  }
  return { status, headers: picked, bodyType: "text", body: text };
}

// ── Shapes ──────────────────────────────────────────────────────────────────
//
// A shape is the set of kinds a value can take, keyed by kind:
//   { string: true, null: true }               a string or null
//   { object: { id: Shape, name: Shape } }      an object and the shape of each key
//   { array: Shape }                            an array and the union of its items ({} = empty)
// Merging two shapes unions their kinds, an object's keys and an array's items.
// Optional keys are not tracked: an object's keys are those seen on any element.

function kindOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function shapeOf(value) {
  const kind = kindOf(value);
  if (kind === "array") return { array: value.reduce((acc, item) => mergeShapes(acc, shapeOf(item)), {}) };
  if (kind === "object") {
    const keys = {};
    for (const key of Object.keys(value).sort()) keys[key] = shapeOf(value[key]);
    return { object: keys };
  }
  return { [kind]: true };
}

function mergeShapes(a, b) {
  const out = {};
  for (const kind of KIND_ORDER) {
    if (!(kind in a) && !(kind in b)) continue;
    if (!(kind in a)) out[kind] = b[kind];
    else if (!(kind in b)) out[kind] = a[kind];
    else if (kind === "array") out.array = mergeShapes(a.array, b.array);
    else if (kind === "object") {
      const keys = {};
      for (const key of [...new Set([...Object.keys(a.object), ...Object.keys(b.object)])].sort()) {
        if (!(key in a.object)) keys[key] = b.object[key];
        else if (!(key in b.object)) keys[key] = a.object[key];
        else keys[key] = mergeShapes(a.object[key], b.object[key]);
      }
      out.object = keys;
    } else out[kind] = true;
  }
  return out;
}

function describeShape(shape) {
  const kinds = KIND_ORDER.filter((kind) => kind in shape);
  return kinds.length ? kinds.join("|") : "nothing (empty array)";
}

// ── Diffing ─────────────────────────────────────────────────────────────────

function childPath(parent, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function preview(value) {
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function typedPreview(value) {
  return value === null ? "null" : `${kindOf(value)} ${preview(value)}`;
}

/** Deep-equal diff of two JSON values; returns one line per difference. Key order is not compared. */
function diffValues(expected, actual, at = "body", out = []) {
  const ke = kindOf(expected);
  const ka = kindOf(actual);
  if (ke !== ka) {
    out.push(`${at}: ${typedPreview(expected)} -> ${typedPreview(actual)}`);
  } else if (ke === "array") {
    if (expected.length !== actual.length) out.push(`${at}: array length ${expected.length} -> ${actual.length}`);
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
      diffValues(expected[i], actual[i], `${at}[${i}]`, out);
    }
  } else if (ke === "object") {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      const p = childPath(at, key);
      if (!Object.hasOwn(actual, key)) out.push(`${p}: key removed (was ${preview(expected[key])})`);
      else if (!Object.hasOwn(expected, key)) out.push(`${p}: key added (${preview(actual[key])})`);
      else diffValues(expected[key], actual[key], p, out);
    }
  } else if (expected !== actual) {
    out.push(`${at}: ${preview(expected)} -> ${preview(actual)}`);
  }
  return out;
}

/** Diff of two shapes; returns one line per difference. `[]` in a path means "every array item". */
function diffShapes(expected, actual, at = "body", out = []) {
  const de = describeShape(expected);
  const da = describeShape(actual);
  if (de !== da) out.push(`${at}: ${de} -> ${da}`);
  if (expected.object && actual.object) {
    for (const key of [...new Set([...Object.keys(expected.object), ...Object.keys(actual.object)])].sort()) {
      const p = childPath(at, key);
      if (!(key in actual.object)) out.push(`${p}: key removed (was ${describeShape(expected.object[key])})`);
      else if (!(key in expected.object)) out.push(`${p}: key added (${describeShape(actual.object[key])})`);
      else diffShapes(expected.object[key], actual.object[key], p, out);
    }
  }
  if (expected.array && actual.array) diffShapes(expected.array, actual.array, `${at}[]`, out);
  return out;
}

function describeHeader(value) {
  return value === null ? "(absent)" : JSON.stringify(value);
}

function diffText(expected, actual) {
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  const around = (s) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20));
  return `body: text differs at char ${i}: ${around(expected)} -> ${around(actual)}`;
}

/** Every difference between two recorded responses, as report lines. */
function compareRecords(expected, actual, mode) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode} (expected ${MODES.join(" or ")})`);
  const out = [];
  if (expected.status !== actual.status) out.push(`status: ${expected.status} -> ${actual.status}`);
  for (const name of HEADERS) {
    const e = expected.headers[name] ?? null;
    const a = actual.headers[name] ?? null;
    if (mode === "shape" && name === "etag") {
      if ((e === null) !== (a === null)) {
        out.push(`header etag: ${e === null ? "absent" : "present"} -> ${a === null ? "absent" : "present"}`);
      }
    } else if (e !== a) {
      out.push(`header ${name}: ${describeHeader(e)} -> ${describeHeader(a)}`);
    }
  }
  if (expected.bodyType !== actual.bodyType) {
    out.push(`body: ${expected.bodyType} -> ${actual.bodyType}`);
  } else if (expected.bodyType === "json") {
    if (mode === "exact") diffValues(expected.body, actual.body, "body", out);
    else diffShapes(shapeOf(expected.body), shapeOf(actual.body), "body", out);
  } else if (mode === "exact" && expected.body !== actual.body) {
    out.push(diffText(expected.body, actual.body));
  }
  return out;
}

/** One result per path: the snapshot's record for it against the live one. */
function diffSnapshot(snapshot, actualByPath, paths, mode) {
  return paths.map((p) => {
    const expected = snapshot.responses[p];
    if (!expected) return { path: p, differences: ["not in the snapshot (capture it first)"] };
    return { path: p, differences: compareRecords(expected, actualByPath[p], mode) };
  });
}

function formatReport(results, mode, maxLinesPerUrl = MAX_LINES_PER_URL) {
  const lines = [];
  for (const { path: p, differences } of results) {
    if (!differences.length) {
      lines.push(`ok    ${p}`);
      continue;
    }
    lines.push(`DIFF  ${p}`);
    for (const d of differences.slice(0, maxLinesPerUrl)) lines.push(`        ${d}`);
    if (differences.length > maxLinesPerUrl) lines.push(`        ... and ${differences.length - maxLinesPerUrl} more`);
  }
  const differing = results.filter((r) => r.differences.length).length;
  lines.push("");
  lines.push(
    differing
      ? `${differing} of ${results.length} URL(s) differ (${mode} mode)`
      : `no difference across ${results.length} URL(s) (${mode} mode)`,
  );
  return lines.join("\n") + "\n";
}

// ── Snapshot file ───────────────────────────────────────────────────────────

function readSnapshot(file) {
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  if (snapshot.version !== SNAPSHOT_VERSION || typeof snapshot.responses !== "object" || snapshot.responses === null) {
    throw new Error(`${file} is not a compare-responses snapshot (version ${SNAPSHOT_VERSION})`);
  }
  return snapshot;
}

/** True when `file` lies inside this repository at a path git does not ignore. */
function isTrackableInRepo(file) {
  const rel = path.relative(ROOT, path.resolve(file));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return spawnSync("git", ["-C", ROOT, "check-ignore", "-q", "--", rel]).status !== 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: compare-responses.js capture --base <url> --urls <file> --out <snapshot.json> [--lang ko] [--force]\n" +
  "       compare-responses.js diff --against <snapshot.json> [--base <url>] [--urls <file>] [--mode exact|shape]";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "capture" && command !== "diff") throw new Error(USAGE);
  const valued = { capture: ["--base", "--urls", "--out", "--lang"], diff: ["--base", "--urls", "--against", "--mode"] };
  const args = { command, force: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--force" && command === "capture") {
      args.force = true;
    } else if (valued[command].includes(flag)) {
      const value = rest[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      args[flag.slice(2)] = value;
    } else {
      throw new Error(`unknown argument for ${command}: ${flag}\n${USAGE}`);
    }
  }
  if (command === "capture") {
    for (const flag of ["base", "urls", "out"]) if (!args[flag]) throw new Error(`capture needs --${flag}\n${USAGE}`);
    args.lang = args.lang || "ko";
  } else {
    if (!args.against) throw new Error(`diff needs --against\n${USAGE}`);
    args.mode = args.mode || "exact";
    if (!MODES.includes(args.mode)) throw new Error(`--mode must be ${MODES.join(" or ")}`);
  }
  return args;
}

function normalizeBase(base) {
  const url = new URL(base);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`--base must be http(s): ${base}`);
  if (url.search || url.hash) throw new Error(`--base takes no query or fragment: ${base}`);
  return url.href.replace(/\/+$/, "");
}

async function fetchRecord(base, p, { lang, authorization }) {
  const headers = { "accept-language": lang, "user-agent": USER_AGENT };
  if (authorization) headers.authorization = authorization;
  let res;
  try {
    // Concatenated, not `new URL(p, base)`: the path stays on the base host.
    res = await fetch(base + p, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`GET ${p}: ${err.cause?.message || err.message}`, { cause: err });
  }
  return buildRecord({ status: res.status, headers: res.headers, text: await res.text() });
}

async function fetchAll(base, paths, options) {
  const byPath = {};
  for (const p of paths) {
    byPath[p] = await fetchRecord(base, p, options);
    const { status } = byPath[p];
    console.log(`${status}${status >= 400 ? " !" : "  "} ${p}`);
  }
  return byPath;
}

async function capture(args) {
  if (fs.existsSync(args.out) && !args.force) {
    throw new Error(`${args.out} exists. It may be the "before" snapshot; pass --force to overwrite it`);
  }
  if (isTrackableInRepo(args.out)) {
    throw new Error(`${args.out} is inside the repository and not gitignored. Write snapshots outside the repo.`);
  }
  const base = normalizeBase(args.base);
  const paths = parseUrlList(fs.readFileSync(args.urls, "utf8"));
  const authorization = process.env[AUTH_ENV] || "";
  console.log(`capture ${paths.length} URL(s) from ${base} (Authorization: ${authorization ? AUTH_ENV : "none"})`);
  const responses = await fetchAll(base, paths, { lang: args.lang, authorization });
  const snapshot = {
    version: SNAPSHOT_VERSION,
    base,
    lang: args.lang,
    authorization: Boolean(authorization),
    capturedAt: new Date().toISOString(),
    responses,
  };
  fs.writeFileSync(args.out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`wrote ${args.out}`);
  return 0;
}

async function diff(args) {
  const snapshot = readSnapshot(args.against);
  const base = normalizeBase(args.base || snapshot.base);
  const paths = args.urls ? parseUrlList(fs.readFileSync(args.urls, "utf8")) : Object.keys(snapshot.responses);
  const authorization = process.env[AUTH_ENV] || "";
  if (Boolean(authorization) !== snapshot.authorization) {
    console.error(
      `warning: the snapshot was captured ${snapshot.authorization ? "with" : "without"} ${AUTH_ENV}, ` +
        `this run is ${authorization ? "with" : "without"} it`,
    );
  }
  const skipped = Object.keys(snapshot.responses).filter((p) => !paths.includes(p)).length;
  console.log(
    `diff ${paths.length} URL(s) from ${base} against ${args.against} (captured ${snapshot.capturedAt} ` +
      `from ${snapshot.base}, lang ${snapshot.lang})` +
      (skipped ? `; ${skipped} snapshot URL(s) not in the list are skipped` : ""),
  );
  const actual = await fetchAll(base, paths, { lang: snapshot.lang, authorization });
  const results = diffSnapshot(snapshot, actual, paths, args.mode);
  process.stdout.write("\n" + formatReport(results, args.mode));
  return results.some((r) => r.differences.length) ? 1 : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  return args.command === "capture" ? capture(args) : diff(args);
}

module.exports = {
  buildRecord,
  compareRecords,
  diffShapes,
  diffSnapshot,
  diffValues,
  formatReport,
  mergeShapes,
  parseArgs,
  parseUrlList,
  shapeOf,
};

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`compare-responses: ${err.message}`);
      process.exit(1);
    },
  );
}
