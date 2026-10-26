/**
 * The drift check of the produced contracts (ADR 0010, D13). The `*.json` files directly in
 * `contracts/produced/` must equal what the `.wire` files export today:
 * `index.json` and one `<id>.schema.json` per zod export. `npm test` runs
 * this, so CI fails on a stale artifact; `npm run contracts:export` runs this
 * file alone with `CONTRACTS_WRITE=1`, which rewrites the files that differ
 * and deletes an orphaned `<id>.schema.json`. `fixtures/` is never touched.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { producedFiles, sourceRoutes, wireModules, wireSchemas } from "../helpers/contracts/artifacts";
import {
  PRODUCED_DIR,
  diffProduced,
  driftMessage,
  isEmptyDiff,
  readProduced,
  writeProduced,
} from "../helpers/contracts/produced";

describe("drift check applies as specified", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "contracts-produced-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  };

  const expected = new Map([
    ["index.json", "{ new }\n"],
    ["a.x.schema.json", "a\n"],
    ["b.y.schema.json", "b\n"],
  ]);

  it("reads only the *.json files directly in the folder", () => {
    // Arrange
    write("index.json", "{}\n");
    write("README.md", "notes\n");
    write("fixtures/a.x/case.json", "{}\n");

    // Act
    const files = readProduced(dir);

    // Assert
    expect([...files]).toEqual([["index.json", "{}\n"]]);
    expect(readProduced(path.join(dir, "absent"))).toEqual(new Map());
  });

  it("names the stale, missing and extra files", () => {
    // Arrange
    const actual = new Map([
      ["index.json", "{ old }\n"],
      ["a.x.schema.json", "a\n"],
      ["gone.z.schema.json", "z\n"],
      ["notes.json", "{}\n"],
    ]);

    // Act
    const diff = diffProduced(expected, actual);

    // Assert
    expect(diff).toEqual({ stale: ["index.json"], missing: ["b.y.schema.json"], extra: ["gone.z.schema.json", "notes.json"] });
    expect(isEmptyDiff(diff)).toBe(false);
    expect(isEmptyDiff(diffProduced(expected, expected))).toBe(true);
  });

  it("rewrites only what differs, deletes an orphaned schema, and leaves fixtures and other files alone", () => {
    // Arrange
    write("index.json", "{ old }\n");
    write("a.x.schema.json", "a\n");
    write("gone.z.schema.json", "z\n");
    write("notes.json", "{}\n");
    write("fixtures/gone.z/case.json", '{ "_about": "kept" }\n');
    const untouched = new Date(0);
    fs.utimesSync(path.join(dir, "a.x.schema.json"), untouched, untouched);

    // Act
    writeProduced(dir, expected, diffProduced(expected, readProduced(dir)));

    // Assert
    expect(diffProduced(expected, readProduced(dir))).toEqual({ stale: [], missing: [], extra: ["notes.json"] });
    expect(fs.statSync(path.join(dir, "a.x.schema.json")).mtime).toEqual(untouched);
    expect(fs.readFileSync(path.join(dir, "fixtures/gone.z/case.json"), "utf8")).toBe('{ "_about": "kept" }\n');
  });

  // (An operations detail is left out of the public history.)
  it("refuses to write into a checkout whose src/private/ holds an overlay", () => {
    // Arrange
    const produced = path.join(dir, "contracts/produced");
    fs.mkdirSync(path.join(dir, "src/private"), { recursive: true });

    // Act
    const exportInto = () => writeProduced(produced, expected, diffProduced(expected, readProduced(produced)));

    // Assert
    expect(exportInto).toThrow("src/private/");
    expect(readProduced(produced)).toEqual(new Map());
  });

  it("points a failure at the stale, missing and extra names and at the export script", () => {
    // Act
    const message = driftMessage({ stale: ["index.json"], missing: ["b.y.schema.json"], extra: ["notes.json"] });

    // Assert
    expect(message).toMatch(/Stale:\n {2}- index\.json\nMissing:\n {2}- b\.y\.schema\.json\nExtra[^\n]*\n {2}- notes\.json/);
    expect(message).toContain("npm run contracts:export");
  });
});

describe("contracts/produced/", () => {
  it("matches what the .wire files export (CONTRACTS_WRITE=1 rewrites it)", () => {
    // Arrange
    const expectedFiles = producedFiles(wireSchemas(wireModules()), sourceRoutes());
    if (process.env.CONTRACTS_WRITE === "1") {
      writeProduced(PRODUCED_DIR, expectedFiles, diffProduced(expectedFiles, readProduced(PRODUCED_DIR)));
    }

    // Act
    const diff = diffProduced(expectedFiles, readProduced(PRODUCED_DIR));

    // Assert
    if (!isEmptyDiff(diff)) throw new Error(driftMessage(diff));
    expect(diff).toEqual({ stale: [], missing: [], extra: [] });
  });
});
