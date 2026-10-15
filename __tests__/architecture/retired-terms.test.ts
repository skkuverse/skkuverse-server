/**
 * The files an agent loads with every session or edit (`CLAUDE.md`,
 * `.claude/rules/**`) name no concept the refactor retired (PR 255 F3): an
 * agent reads "unmigrated modules keep their mocks" as permission, though
 * every rule is strict in every module since the close-out. The ADRs keep
 * their dated history and are not read.
 */
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RETIRED: ReadonlyArray<readonly [string, RegExp]> = [
  ["a migrated scope", /\bmigrated (?:scopes?|modules?)\b/i],
  ["unmigrated", /\bunmigrated\b/i],
  ["the per-module app builders", /\bbuild-(?!test-app\b)(?:<module>|[a-z-]+)-app\b/],
  ["migrated-scopes", /\bmigrated-scopes\b/],
];

/** `<file>:<line>: <term>` for each retired term a file's text names. */
export function retiredTerms(file: string, text: string): string[] {
  return text.split("\n").flatMap((line, i) => RETIRED.filter(([, pattern]) => pattern.test(line)).map(([term]) => `${file}:${i + 1}: ${term}`));
}

describe("retired term rule applies as specified", () => {
  it.each([
    ["Checked by `spec-mocks` in migrated scopes.", "a migrated scope"],
    ["In migrated modules each role has a cap.", "a migrated scope"],
    ["Unmigrated modules keep their module mocks.", "unmigrated"],
    ["The `build-<module>-app.ts` builders are legacy.", "the per-module app builders"],
    ["Move off `build-map-app.ts`.", "the per-module app builders"],
    ["Listed in `migrated-scopes.json`.", "migrated-scopes"],
  ])("refuses %j", (line, term) => {
    // Act & Assert
    expect(retiredTerms("x.md", line)).toEqual([`x.md:1: ${term}`]);
  });

  it("passes the words in their current senses", () => {
    // Act & Assert
    expect(retiredTerms("x.md", "Every module scope is strict. The bus routes migrated from Express keep their paths. `build-test-app.ts` boots it.")).toEqual([]);
  });
});

describe("CLAUDE.md and .claude/rules/", () => {
  it("name no retired concept", () => {
    // Arrange
    const files = ["CLAUDE.md", ...filesUnder(".claude/rules").filter((f) => f.endsWith(".md"))];

    // Act
    const found = files.flatMap((f) => retiredTerms(f, readSource(f)));

    // Assert
    expect(files.length).toBeGreaterThan(1);
    expect(found).toEqual([]);
  });
});
