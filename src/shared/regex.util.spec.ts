/**
 * escapeRegex makes user input match literally; captureGroups returns typed groups, null on no match,
 * and throws on a missing group or a stateful pattern.
 */
import { captureGroups, escapeRegex } from "./regex.util";

describe("escapeRegex", () => {
  it("escapes every metacharacter", () => {
    // Act & Assert
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("matches the input literally", () => {
    // Act & Assert
    for (const input of ["a.b", "(27)", "c++", "1+1=2", "[x]", "도서관?"]) {
      expect(new RegExp(`^${escapeRegex(input)}$`).test(input)).toBe(true);
    }
    expect(new RegExp(escapeRegex("a.b")).test("axb")).toBe(false);
  });
});

describe("captureGroups", () => {
  it("returns the groups it was asked for, or null when the text does not match", () => {
    // Act & Assert
    expect(captureGroups("지하2층", /^지하(\d+)층$/, 1)).toEqual(["2"]);
    expect(captureGroups("A-27", /^(\w)-(\d+)$/, 2)).toEqual(["A", "27"]);
    expect(captureGroups("로비", /^지하(\d+)층$/, 1)).toBeNull();
  });

  it("throws when a match leaves a group it reads empty, naming the pattern", () => {
    // Act & Assert
    expect(() => captureGroups("b", /^(a)?b$/, 1)).toThrow("/^(a)?b$/ matched without 1 capture groups");
  });

  it("throws when the pattern has fewer groups than asked for", () => {
    // Act & Assert
    expect(() => captureGroups("a", /^(a)$/, 2)).toThrow("/^(a)$/ matched without 2 capture groups");
  });

  it.each([/(a)/g, /(a)/y])("refuses %s, whose lastIndex would carry between calls", (pattern) => {
    // Act & Assert
    expect(() => captureGroups("a", pattern, 1)).toThrow("captureGroups takes a pattern without g or y");
  });
});
