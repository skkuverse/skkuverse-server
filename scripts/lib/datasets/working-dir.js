/**
 * The directory `npm run data -- pull` writes for a parted dataset and `push`
 * reads (openspec/changes/move-reference-datasets, design D4):
 *
 *   .data/<dev|prod>/<dataset>/working.json
 *     { "dataset", "target": "dev" | "prod", "baseRevision", "pulledAt", "manifest" }
 *   .data/<dev|prod>/<dataset>/parts/<key>.json   each part's data
 *
 * `working.json` plays the working file's role (working-file.js): the revision
 * a push is based on, and the database it may go back to. A push reads every
 * `*.json` under `parts/` and keys each by the dataset's `keyOf`, not by its
 * file name, so a converter may write the files under any name. `/.data/` is
 * git-ignored: the stored dataset is the source of truth.
 */
const fs = require("node:fs");
const path = require("node:path");

const TARGETS = ["dev", "prod"];
const WORKING = "working.json";
const PARTS = "parts";

function workingDirPath(root, target, dataset) {
  return path.join(root, ".data", target, dataset);
}

function writeWorking(dir, { dataset, target, baseRevision, pulledAt, manifest }) {
  fs.writeFileSync(path.join(dir, WORKING), `${JSON.stringify({ dataset, target, baseRevision, pulledAt, manifest }, null, 2)}\n`);
}

/** Replaces the directory's parts with `parts` (`{ key, data }`), one `<key>.json` each, and writes `working`. */
function writeWorkingDir(dir, working, parts) {
  const partsDir = path.join(dir, PARTS);
  fs.rmSync(partsDir, { recursive: true, force: true });
  fs.mkdirSync(partsDir, { recursive: true });
  for (const { key, data } of parts) {
    if (path.basename(key) !== key || key.startsWith(".")) throw new Error(`part key "${key}" cannot be a file name`);
    fs.writeFileSync(path.join(partsDir, `${key}.json`), `${JSON.stringify(data, null, 2)}\n`);
  }
  writeWorking(dir, working);
}

/** Every `*.json` directly in `dir`, by name, as `{ file, data }`; throws naming a file that is not JSON. */
function readPartFiles(dir) {
  if (!fs.existsSync(dir)) throw new Error(`no directory at ${dir}`);
  const names = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (names.length === 0) throw new Error(`${dir} holds no *.json part file`);
  return names.map((name) => {
    const file = path.join(dir, name);
    try {
      return { file: name, data: JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch (err) {
      throw new Error(`${file} is not valid JSON: ${err.message}`, { cause: err });
    }
  });
}

/** `{ working, files }` of the directory at `dir`; throws naming what is wrong with it. */
function readWorkingDir(dir) {
  const file = path.join(dir, WORKING);
  if (!fs.existsSync(file)) throw new Error(`no working directory at ${dir}: run \`pull\` first`);
  let working;
  try {
    working = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`, { cause: err });
  }
  const problems = [
    typeof working?.dataset !== "string" && "`dataset` is not a string",
    !TARGETS.includes(working?.target) && "`target` is not \"dev\" or \"prod\"",
    !(Number.isInteger(working?.baseRevision) && working.baseRevision > 0) && "`baseRevision` is not a positive integer",
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`${file} is not a working file written by \`pull\`: ${problems.join("; ")}`);
  return { working, files: readPartFiles(path.join(dir, PARTS)) };
}

module.exports = { readPartFiles, readWorkingDir, workingDirPath, writeWorking, writeWorkingDir };
