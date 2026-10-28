#!/usr/bin/env node
/**
 * Copy the crawler's row golden cases into __tests__/nest/notices/fixtures/facts-rows/, the oracle of
 * src/notices/row/notices-row.rules.spec.ts. Each case is skkuverse-crawler's
 * py/tests/plugins/facts/fixtures/rows/<case>.json (the facts record row.py read, the day `now`, and row.py's output
 * as `expected`), read from a commit, never from a working tree, and stamped with the `_about` every fixture carries.
 *
 * Usage:
 *   node scripts/sync-facts-row-fixtures.js [--crawler ../skkuverse-crawler] [--ref origin/dev]
 *
 * Fetch the crawler first. Rerun whenever the crawler regenerates its fixtures (its row.py, record.py or test_row.py
 * changed), then rerun `npx jest src/notices/row` and review the override table there against the new expected rows.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "__tests__/nest/notices/fixtures/facts-rows");
const CASES = "py/tests/plugins/facts/fixtures/rows";

function parseArgs(argv) {
  const args = { crawler: path.join(ROOT, "../skkuverse-crawler"), ref: "origin/dev" };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--crawler" && value) args.crawler = path.resolve(value);
    else if (flag === "--ref" && value) args.ref = value;
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

function main() {
  const { crawler, ref } = parseArgs(process.argv.slice(2));
  const git = (...gitArgs) => execFileSync("git", ["-C", crawler, ...gitArgs], { encoding: "utf8", maxBuffer: 1 << 26 });
  const commit = git("rev-parse", "--short", ref).trim();
  const captured = new Date().toISOString().slice(0, 10);
  const names = git("ls-tree", "--name-only", `${ref}:${CASES}`).split("\n").filter((name) => name.endsWith(".json"));
  fs.mkdirSync(OUT, { recursive: true });
  for (const stale of fs.readdirSync(OUT).filter((name) => name.endsWith(".json") && !names.includes(name))) {
    fs.unlinkSync(path.join(OUT, stale));
  }
  for (const name of names) {
    const golden = JSON.parse(git("show", `${ref}:${CASES}/${name}`));
    const about =
      `Synthetic: the crawler's golden row case \`${golden.case}\` (skkuverse-crawler ${CASES}/${name}, commit ${commit}, ` +
      `captured ${captured}), a hand-written test notice built by its record.build, with row.py's own output as \`expected\`. No user data.`;
    fs.writeFileSync(path.join(OUT, name), `${JSON.stringify({ _about: about, ...golden }, null, 2)}\n`);
  }
  process.stdout.write(`wrote ${names.length} fixtures from skkuverse-crawler ${commit} to ${path.relative(ROOT, OUT)}\n`);
}

main();
