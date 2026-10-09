/**
 * The ratchet every architecture rule runs through. A rule may only lose
 * allowlisted violations, never gain one, and a fixed entry must be deleted.
 */
import path from "path";
import {
  compareWithAllowlist,
  expectAllowlisted,
  readAllowlist,
} from "../helpers/architecture/ratchet";

const FIXTURES = path.join(__dirname, "fixtures/ratchet");

describe("architecture ratchet", () => {
  it("passes when the violations are exactly the allowlist", () => {
    expect(() => expectAllowlisted("sorted", ["src/b.ts", "src/a.ts"], FIXTURES)).not.toThrow();
  });

  it("fails on a violation that is not allowlisted, and names it", () => {
    expect(() => expectAllowlisted("sorted", ["src/a.ts", "src/b.ts", "src/c.ts"], FIXTURES)).toThrow(
      /New violations[\s\S]*- src\/c\.ts/,
    );
  });

  it("fails on an allowlisted entry that no longer violates, and prints the shorter list", () => {
    let message = "";
    try {
      expectAllowlisted("sorted", ["src/a.ts"], FIXTURES);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/No longer violating[\s\S]*- src\/b\.ts/);
    expect(message).toContain('[\n  "src/a.ts"\n]');
  });

  it("does not offer a new violation in the regenerated list", () => {
    expect(() => expectAllowlisted("sorted", ["src/a.ts", "src/b.ts", "src/new.ts"], FIXTURES)).toThrow(
      /Allowlist after removing the fixed entries[^\n]*\n\[\n {2}"src\/a\.ts",\n {2}"src\/b\.ts"\n\]/,
    );
  });

  it("treats a missing allowlist as empty", () => {
    expect(readAllowlist("missing", FIXTURES)).toEqual([]);
    expect(() => expectAllowlisted("missing", [], FIXTURES)).not.toThrow();
    expect(() => expectAllowlisted("missing", ["src/a.ts"], FIXTURES)).toThrow(/New violations/);
  });

  it.each(["unsorted", "duplicated"])("rejects an allowlist that is %s", (rule) => {
    expect(() => readAllowlist(rule, FIXTURES)).toThrow(/must be sorted and free of duplicates/);
  });

  it("rejects an allowlist that is not an array of strings", () => {
    expect(() => readAllowlist("not-an-array", FIXTURES)).toThrow(/JSON array of strings/);
  });

  it("compares as sets", () => {
    expect(compareWithAllowlist(["x", "x", "y"], ["y", "z"])).toEqual({ added: ["x"], fixed: ["z"] });
  });
});
