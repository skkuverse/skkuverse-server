/**
 * No line in src/ or __tests__/ may cite a file that no longer exists. The
 * Express app — index.ts, lib/ and features/ — was deleted when the server
 * moved to NestJS, and a comment that still points there sends a reader, or an
 * agent, looking for code that is gone, with claims about it nobody can check.
 * Comments describe the code as it is; git keeps the history.
 *
 * Flagged: the deleted entrypoint (index.js / index.ts, with or without a line
 * number), a path that starts at lib/ or features/, and a __tests__/…test.ts
 * path that does not resolve. A path with a prefix (scripts/lib/, another
 * repo's apps/mobile/src/features/) is a different directory and passes.
 */
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");
const self = path.relative(root, __filename);

const DELETED = [
  /\bindex\.(?:js|ts)(?::\d+)?\b/,
  /(?<![\w/.-])lib\/\w/,
  /(?<![\w/.-])features\/\w/,
];
const TEST_PATH = /__tests__\/[\w./-]+?\.test\.(?:ts|js)\b/g;

function cites(line: string): boolean {
  if (DELETED.some((re) => re.test(line))) return true;
  return [...line.matchAll(TEST_PATH)].some((m) => !fs.existsSync(path.join(root, m[0])));
}

function tsFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(dir, f))
    .filter((f) => f !== self);
}

describe("no stale paths in src/ and __tests__/", () => {
  it("catches the deleted Express paths and nothing with a prefix", () => {
    for (const line of [
      "mirrors index.ts:164-171",
      "same as index.js",
      "via lib/db.getClient()",
      "(lib/responseHelper.ts)",
      "port of features/bus/hssc.fetcher.ts",
      "Nest port of __tests__/ad-stats.test.ts.",
    ]) {
      expect(cites(line)).toBe(true);
    }
    for (const line of [
      'import places from "./index.json";',
      "scripts/lib/map-places-file.js",
      "skkuverse-app/apps/mobile/src/features/games",
      "node_modules/pino/lib/levels",
      "as __tests__/nest/infra/private-file does",
    ]) {
      expect(cites(line)).toBe(false);
    }
  });

  it("no line cites a deleted file", () => {
    const stale: string[] = [];
    for (const file of [...tsFiles("src"), ...tsFiles("__tests__")]) {
      fs.readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (cites(line)) stale.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(stale).toEqual([]);
  });
});
