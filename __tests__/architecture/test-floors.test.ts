/**
 * No module loses tests silently (harden-test-suite design D3). Each module's
 * test calls and `expect(…)` calls (its `src/<module>/**\/*.spec.ts` and
 * `__tests__/nest/<module>/**`) may not drop below `test-floors.json`. A move
 * within a module changes nothing; a deletion or merge lowers the floor in the
 * same diff, which is the review signal. A rise passes; rewrite the file to
 * raise the floors.
 */
import fs from "fs";
import path from "path";
import { ROOT } from "../helpers/architecture/ratchet";
import { readSource } from "../helpers/architecture/tree";
import { parseTestFile, testFiles } from "../helpers/architecture/tests";

const FLOORS_FILE = path.join(ROOT, "__tests__/architecture/test-floors.json");
const WRITE_COMMAND = "TEST_FLOORS_WRITE=1 npx jest __tests__/architecture/test-floors.test.ts";

export interface Counts {
  tests: number;
  expects: number;
}

/** The module a test file counts toward. */
export function moduleOf(file: string): string {
  const owned = file.match(/^src\/([^/]+)\//) ?? file.match(/^__tests__\/nest\/([^/]+)\//);
  if (owned) return owned[1]!;
  const grouped = file.match(/^__tests__\/([^/]+)\//);
  return grouped ? grouped[1]! : "__tests__";
}

export function countTests(files: ReadonlyArray<readonly [string, string]>): Record<string, Counts> {
  const counts: Record<string, Counts> = {};
  for (const [file, text] of files) {
    const { calls, expectCalls } = parseTestFile(file, text);
    const entry = (counts[moduleOf(file)] ??= { tests: 0, expects: 0 });
    entry.tests += calls.filter((c) => c.kind === "test").length;
    entry.expects += expectCalls;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** `<module>: <what> <actual> < floor <floor>` for each count below its floor. */
export function floorViolations(actual: Record<string, Counts>, floors: Record<string, Counts>): string[] {
  return Object.entries(floors).flatMap(([module, floor]) => {
    const now = actual[module] ?? { tests: 0, expects: 0 };
    return (["tests", "expects"] as const)
      .filter((what) => now[what] < floor[what])
      .map((what) => `${module}: ${what} ${now[what]} < floor ${floor[what]}`);
  });
}

describe("test floor rules apply as specified", () => {
  it.each([
    ["src/building/sync/building-sync.client.spec.ts", "building"],
    ["__tests__/nest/building/building.routes.test.ts", "building"],
    ["__tests__/nest/bootstrap-wiring.test.ts", "nest"],
    ["__tests__/architecture/naming.test.ts", "architecture"],
    ["__tests__/scripts/compare-responses.test.ts", "scripts"],
  ])("counts %s toward %s", (file, module) => {
    // Act & Assert
    expect(moduleOf(file)).toBe(module);
  });

  it("counts test calls, each it.each once, and every expect call", () => {
    // Arrange
    const text = 'describe("s", () => {\n  it("a", () => { expect(1).toBe(1); expect(2).toBe(2); });\n  it.each([[1], [2]])("b %s", () => { expect(1).toBe(1); });\n  it.todo("c");\n});';

    // Act
    const counts = countTests([["src/x/x.spec.ts", text]]);

    // Assert
    expect(counts).toEqual({ x: { tests: 3, expects: 3 } });
  });

  it("fails a count below its floor, including a module that vanished, and passes a rise", () => {
    // Arrange
    const floors = { a: { tests: 5, expects: 9 }, b: { tests: 2, expects: 2 }, c: { tests: 1, expects: 1 } };
    const actual = { a: { tests: 4, expects: 12 }, b: { tests: 3, expects: 3 } };

    // Act
    const violations = floorViolations(actual, floors);

    // Assert
    expect(violations).toEqual(["a: tests 4 < floor 5", "c: tests 0 < floor 1", "c: expects 0 < floor 1"]);
  });
});

describe("test floors", () => {
  it("hold in every module", () => {
    // Arrange
    const actual = countTests(testFiles().map((f) => [f, readSource(f)] as const));
    if (process.env.TEST_FLOORS_WRITE === "1") {
      fs.writeFileSync(FLOORS_FILE, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const floors = JSON.parse(fs.readFileSync(FLOORS_FILE, "utf8")) as Record<string, Counts>;

    // Act
    const violations = floorViolations(actual, floors);

    // Assert
    if (violations.length > 0) {
      throw new Error(
        [
          "[architecture:test-floors] Fewer tests or expect calls than the floor:",
          ...violations.map((v) => `  - ${v}`),
          "Deleting or merging tests lowers the floor in the same diff, with the reason in the commit:",
          `  ${WRITE_COMMAND}`,
        ].join("\n"),
      );
    }
    expect(violations).toEqual([]);
  });
});
