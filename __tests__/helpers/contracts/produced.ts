/**
 * The committed artifacts in `contracts/produced/` against the ones computed
 * from the `.wire` files (ADR 0010, D13): which are
 * stale, missing or extra, and the rewrite `npm run contracts:export` asks
 * for. Only the `*.json` files directly in the folder take part; the
 * hand-trimmed `fixtures/` below it are never read or written here.
 */
import fs from "fs";
import path from "path";
import { ROOT } from "../architecture/ratchet";
import { SCHEMA_SUFFIX } from "./artifacts";

export const PRODUCED_DIR = path.join(ROOT, "contracts/produced");

export interface ProducedDiff {
  /** On disk with other content. */
  stale: string[];
  /** Computed, not on disk. */
  missing: string[];
  /** On disk, not computed. */
  extra: string[];
}

/** File name → content of each `*.json` directly in `dir`; an absent folder is empty. */
export function readProduced(dir: string): Map<string, string> {
  if (!fs.existsSync(dir)) return new Map();
  return new Map(
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]),
  );
}

export function diffProduced(expected: ReadonlyMap<string, string>, actual: ReadonlyMap<string, string>): ProducedDiff {
  const names = (pick: (name: string) => boolean, from: ReadonlyMap<string, string>) => [...from.keys()].filter(pick).sort();
  return {
    stale: names((n) => actual.has(n) && actual.get(n) !== expected.get(n), expected),
    missing: names((n) => !actual.has(n), expected),
    extra: names((n) => !expected.has(n), actual),
  };
}

export const isEmptyDiff = (diff: ProducedDiff) =>
  diff.stale.length === 0 && diff.missing.length === 0 && diff.extra.length === 0;

/**
 * Writes the stale and missing files and deletes each extra `<id>.schema.json`; any other extra file stays.
 * Refuses when the checkout holding `dir` (`<checkout>/contracts/produced`) has a `src/private/`: the produced
 * contracts are public, and none is written from a tree that holds the private perimeter overlay.
 */
export function writeProduced(dir: string, expected: ReadonlyMap<string, string>, diff: ProducedDiff): void {
  if (fs.existsSync(path.join(dir, "../../src/private"))) {
    throw new Error("[contracts] Refusing to write contracts/produced/ while src/private/ holds the perimeter overlay: remove it first.");
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const name of [...diff.stale, ...diff.missing]) fs.writeFileSync(path.join(dir, name), expected.get(name)!);
  for (const name of diff.extra.filter((n) => n.endsWith(SCHEMA_SUFFIX))) fs.rmSync(path.join(dir, name));
}

export function driftMessage(diff: ProducedDiff): string {
  const section = (title: string, names: readonly string[]) =>
    names.length === 0 ? [] : [title, ...names.map((n) => `  - ${n}`)];
  return [
    "[contracts] contracts/produced/ does not match the .wire files in src/.",
    ...section("Stale:", diff.stale),
    ...section("Missing:", diff.missing),
    ...section("Extra (the export deletes an orphaned <id>.schema.json; delete anything else by hand):", diff.extra),
    "Regenerate with: npm run contracts:export",
  ].join("\n");
}
