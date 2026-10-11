/**
 * A migrated scope (`migrated-scopes.json`, which eslint.config.js reads too) carries no ratchet
 * entry: no allowlist entry and no file in an ESLint boundary block's `ignores` points into it.
 */
import fs from "fs";
import path from "path";
import { Linter } from "eslint";
import { MIGRATED_SCOPES_FILE, inScope, migratedScopes } from "../helpers/architecture/migrated";
import { ALLOWLIST_DIR, ROOT, expectAllowlisted, readAllowlist } from "../helpers/architecture/ratchet";
import { routesIn } from "../helpers/architecture/routes";
import { filesUnder, readSource, sourceFiles } from "../helpers/architecture/tree";

const config: Linter.Config[] = require("../../eslint.config.js");

const RULE = "migrated-scope-entries";
const SCOPE_SHAPE = /^src\/(?:[\w-]+\/)+$|^src\/[\w./-]+\.ts$/;

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

/** Every ratchet list: the allowlists but this rule's own, and each boundary block's ignored violators. */
export function ratchetLists(): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  const rules = fs
    .readdirSync(ALLOWLIST_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter((rule) => rule !== RULE);
  for (const rule of rules) lists.set(`allowlists/${rule}.json`, readAllowlist(rule));
  for (const block of config.filter((c) => c.name?.startsWith("boundaries/"))) {
    // The files import-boundaries.test.ts treats as violators: globs and the two Mongo owners are not.
    const violators = (block.ignores ?? []).filter(
      (p) => !/[*{}]/.test(p) && p !== "src/infra/db.ts" && p !== "src/infra/mongo.ts",
    );
    if (violators.length > 0) lists.set(`eslint ${block.name}`, violators);
  }
  return lists;
}

describe("migrated scope rule applies as specified", () => {
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

describe("migrated scopes", () => {
  it("name src/ folders ending in / or single .ts files that exist, sorted and unique", () => {
    // Arrange
    const scopes = migratedScopes();

    // Act
    const exists = (s: string): boolean =>
      s.endsWith("/") ? filesUnder(s.slice(0, -1)).length > 0 : fs.existsSync(path.join(ROOT, s));
    const bad = scopes.filter((s) => !SCOPE_SHAPE.test(s) || !exists(s));

    // Assert
    expect(bad).toEqual([]);
    expect(scopes).toEqual([...new Set(scopes)].sort());
    expect(scopes.length).toBeGreaterThan(0);
  });

  it(`carry no allowlist or boundary-ignores entry (${MIGRATED_SCOPES_FILE})`, () => {
    // Arrange
    const lists = ratchetLists();

    // Act
    const found = scopedEntries(lists, migratedScopes(), routeFilesOf(sourceFiles()));

    // Assert
    expectAllowlisted(RULE, found);
  });
});
