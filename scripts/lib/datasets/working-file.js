/**
 * The file `npm run data -- pull` writes and `push` reads
 * (ADR 0013, D3 and D4):
 *
 *   .data/<dev|prod>/<dataset>.json
 *   { "dataset", "target": "dev" | "prod", "baseRevision", "pulledAt", "data" }
 *
 * `baseRevision` is what makes a push optimistic: the push stores only while
 * the dataset is still at it. `target` keeps a file pulled from one database
 * from being pushed to the other. `/.data/` is git-ignored: the stored dataset
 * is the source of truth, never this file.
 */
const fs = require("node:fs");
const path = require("node:path");

const TARGETS = ["dev", "prod"];

function workingFilePath(root, target, dataset) {
  return path.join(root, ".data", target, `${dataset}.json`);
}

function writeWorkingFile(file, { dataset, target, baseRevision, pulledAt, data }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ dataset, target, baseRevision, pulledAt, data }, null, 2)}\n`);
}

/** The working file at `file`; throws naming what is wrong with it. */
function readWorkingFile(file) {
  if (!fs.existsSync(file)) throw new Error(`no working file at ${file}: run \`pull\` first`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`, { cause: err });
  }
  const problems = [
    typeof parsed?.dataset !== "string" && "`dataset` is not a string",
    !TARGETS.includes(parsed?.target) && "`target` is not \"dev\" or \"prod\"",
    !(Number.isInteger(parsed?.baseRevision) && parsed.baseRevision > 0) && "`baseRevision` is not a positive integer",
    !(parsed && "data" in parsed) && "`data` is missing",
  ].filter(Boolean);
  if (problems.length > 0) {
    throw new Error(`${file} is not a working file written by \`pull\`: ${problems.join("; ")}`);
  }
  return parsed;
}

module.exports = { readWorkingFile, workingFilePath, writeWorkingFile };
