/**
 * The ratchet every architecture rule runs through. A rule may only lose
 * allowlisted violations, never gain one, and a fixed entry must be deleted.
 *
 * The allowlists under test are written to a temp dir, not kept under
 * `fixtures/`: an allowlist is a JSON array, and `fixture-provenance` requires
 * every fixture to be an object with an `_about` string.
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  compareWithAllowlist,
  expectAllowlisted,
  readAllowlist,
} from "../helpers/architecture/ratchet";

const ALLOWLISTS: Record<string, unknown> = {
  sorted: ["src/a.ts", "src/b.ts"],
  unsorted: ["src/b.ts", "src/a.ts"],
  duplicated: ["src/a.ts", "src/a.ts"],
  "not-an-array": { "src/a.ts": true },
};

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-"));
  for (const [rule, allowlist] of Object.entries(ALLOWLISTS)) {
    fs.writeFileSync(path.join(dir, `${rule}.json`), `${JSON.stringify(allowlist, null, 2)}\n`);
  }
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("architecture ratchet", () => {
  it("passes when the violations are exactly the allowlist", () => {
    expect(() => expectAllowlisted("sorted", ["src/b.ts", "src/a.ts"], dir)).not.toThrow();
  });

  it("fails on a violation that is not allowlisted, and names it", () => {
    expect(() => expectAllowlisted("sorted", ["src/a.ts", "src/b.ts", "src/c.ts"], dir)).toThrow(
      /New violations[\s\S]*- src\/c\.ts/,
    );
  });

  it("fails on an allowlisted entry that no longer violates, and prints the shorter list", () => {
    let message = "";
    try {
      expectAllowlisted("sorted", ["src/a.ts"], dir);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/No longer violating[\s\S]*- src\/b\.ts/);
    expect(message).toContain('[\n  "src/a.ts"\n]');
  });

  it("does not offer a new violation in the regenerated list", () => {
    expect(() => expectAllowlisted("sorted", ["src/a.ts", "src/b.ts", "src/new.ts"], dir)).toThrow(
      /Allowlist after removing the fixed entries[^\n]*\n\[\n {2}"src\/a\.ts",\n {2}"src\/b\.ts"\n\]/,
    );
  });

  it("treats a missing allowlist as empty", () => {
    expect(readAllowlist("missing", dir)).toEqual([]);
    expect(() => expectAllowlisted("missing", [], dir)).not.toThrow();
    expect(() => expectAllowlisted("missing", ["src/a.ts"], dir)).toThrow(/New violations/);
  });

  it.each(["unsorted", "duplicated"])("rejects an allowlist that is %s", (rule) => {
    expect(() => readAllowlist(rule, dir)).toThrow(/must be sorted and free of duplicates/);
  });

  it("rejects an allowlist that is not an array of strings", () => {
    expect(() => readAllowlist("not-an-array", dir)).toThrow(/JSON array of strings/);
  });

  it("compares as sets", () => {
    expect(compareWithAllowlist(["x", "x", "y"], ["y", "z"])).toEqual({ added: ["x"], fixed: ["z"] });
  });
});
