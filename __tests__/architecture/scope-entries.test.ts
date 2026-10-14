/**
 * No ratchet list points into a module scope (scopes.ts; eslint.config.js derives the same list): no
 * allowlist entry and no file in an ESLint boundary block's `ignores` names a file under `src/` or a
 * module's `__tests__/nest/<module>/` tests. Every rule is strict there. A file in `ratchets/` may hold
 * such an entry only while `RATCHET_DECISIONS` (lists.ts) names the decision it waits on; any other
 * ratchet file counts like an allowlist here.
 */
import fs from "fs";
import path from "path";
import { Linter } from "eslint";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { RATCHET_DECISIONS } from "../helpers/architecture/lists";
import { ALLOWLIST_DIR, ROOT, readAllowlist } from "../helpers/architecture/ratchet";
import { routesIn } from "../helpers/architecture/routes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const config: Linter.Config[] = require("../../eslint.config.js");

/** The repo files an entry names: its leading path, or the controller files that declare its route. */
export function entryFiles(entry: string, routeFiles: ReadonlyMap<string, readonly string[]>): string[] {
  const leading = /^((?:src|__tests__)\/[^\s:→]*)/.exec(entry)?.[1];
  if (leading !== undefined) return [leading];
  return [...(routeFiles.get(entry) ?? [])];
}

/** `<list>: <entry>` for each entry that points into a scope. */
export function scopedEntries(
  lists: ReadonlyMap<string, readonly string[]>,
  scopes: readonly string[],
  routeFiles: ReadonlyMap<string, readonly string[]>,
): string[] {
  return [...lists].flatMap(([list, entries]) =>
    entries
      .filter((entry) => entryFiles(entry, routeFiles).some((f) => scopes.some((s) => inScope(f, s))))
      .map((entry) => `${list}: ${entry}`),
  );
}

/** `METHOD path` → the controller files that declare it. */
export function routeFilesOf(files: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of files.filter((f) => f.endsWith(".controller.ts"))) {
    for (const r of routesIn(file, readSource(file))) {
      const key = `${r.method} ${r.path}`;
      out.set(key, [...(out.get(key) ?? []), file]);
    }
  }
  return out;
}

const RATCHET_DIR = path.join(ROOT, "__tests__/architecture/ratchets");

const jsonNames = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)) : [];

/**
 * Every ratchet list: the allowlists, each ratchet not registered with its decision, and each
 * boundary block's ignored violators.
 */
export function ratchetLists(): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (const rule of jsonNames(ALLOWLIST_DIR)) lists.set(`allowlists/${rule}.json`, readAllowlist(rule));
  // A ratchet holds debt under src/ only while it waits on its registered decision (lists.ts).
  for (const rule of jsonNames(RATCHET_DIR).filter((r) => RATCHET_DECISIONS[r] === undefined)) {
    lists.set(`ratchets/${rule}.json`, readAllowlist(rule, RATCHET_DIR));
  }
  for (const block of config.filter((c) => c.name?.startsWith("boundaries/"))) {
    // The files import-boundaries.test.ts treats as violators: globs and the two Mongo owners are not.
    const violators = (block.ignores ?? []).filter(
      (p) => !/[*{}]/.test(p) && p !== "src/infra/db.ts" && p !== "src/infra/mongo.ts",
    );
    if (violators.length > 0) lists.set(`eslint ${block.name}`, violators);
  }
  return lists;
}

describe("scope-entries rule applies as specified", () => {
  const routeFiles = new Map([["GET ad/placements", ["src/ad/placements/ad-placements.controller.ts"]]]);

  it("reads an entry's leading path, the importer of an arrow entry, and a route's controller", () => {
    // Arrange
    const entries = [
      "src/building/x.ts: label",
      "src/bus/a.ts → src/building/b",
      "src/map/: types",
      "__tests__/nest/ad/x.ts",
      "GET ad/placements",
      "GET nowhere",
    ];

    // Act
    const files = entries.map((e) => entryFiles(e, routeFiles));

    // Assert
    expect(files).toEqual([
      ["src/building/x.ts"],
      ["src/bus/a.ts"],
      ["src/map/"],
      ["__tests__/nest/ad/x.ts"],
      ["src/ad/placements/ad-placements.controller.ts"],
      [],
    ]);
  });

  it("flags entries in a folder scope, its __tests__/nest/ tests, a file scope and a route", () => {
    // Arrange
    const lists = new Map([
      ["allowlists/a.json", ["src/building/x.ts: label", "src/buildings/y.ts", "__tests__/nest/building/z.ts"]],
      ["allowlists/b.json", ["src/infra/config.ts: label", "src/infra/db.ts: label", "GET ad/placements"]],
    ]);

    // Act
    const found = scopedEntries(lists, ["src/building/", "src/infra/config.ts", "src/ad/"], routeFiles);

    // Assert
    expect(found).toEqual([
      "allowlists/a.json: src/building/x.ts: label",
      "allowlists/a.json: __tests__/nest/building/z.ts",
      "allowlists/b.json: src/infra/config.ts: label",
      "allowlists/b.json: GET ad/placements",
    ]);
  });
});

describe("module scopes", () => {
  it("are each top-level folder of src/ and each .ts file at its root", () => {
    // Arrange
    const files = ["src/a/x.ts", "src/a/b/y.json", "src/b/z.ts", "src/main.ts", "src/types.d.ts", "src/notes.json"];

    // Act
    const scopes = moduleScopes(files);

    // Assert
    expect(scopes).toEqual(["src/a/", "src/b/", "src/main.ts", "src/types.d.ts"]);
  });

  it("carry no allowlist or boundary-ignores entry", () => {
    // Arrange
    const lists = ratchetLists();

    // Act
    const found = scopedEntries(lists, moduleScopes(), routeFilesOf(sourceFiles()));

    // Assert
    expect(found).toEqual([]);
  });
});
