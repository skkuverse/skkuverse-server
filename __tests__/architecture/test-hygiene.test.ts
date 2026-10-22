/**
 * The tests themselves stay honest (ADR 0011, D8): no focused,
 * skipped or todo test is ever committed, every test body asserts something,
 * and every test body marks its Arrange / Act / Assert steps (tests.md). The
 * assertion and marker rules ratchet: files that broke them when the rules
 * arrived are listed, and a new file must follow both from its first commit.
 */
import { numberedKeys } from "../helpers/architecture/comments";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource } from "../helpers/architecture/tree";
import { aaaInOrder, aaaMarkers, bodyAsserts, parseTestFile, testFiles } from "../helpers/architecture/tests";

/** `<file>: <callee>` for each focused, skipped or todo test or suite. */
export function focusSkipViolations(file: string, text: string): string[] {
  const { calls } = parseTestFile(file, text);
  return numberedKeys(
    file,
    calls.filter((c) => c.focused || c.skipped).map((c) => c.callee),
  );
}

/** `<file>: <title>` for each test whose body asserts nothing. */
export function assertionViolations(file: string, text: string): string[] {
  const { calls } = parseTestFile(file, text);
  return numberedKeys(
    file,
    calls.filter((c) => c.body && !bodyAsserts(c.body)).map((c) => c.title ?? `(line ${c.line})`),
  );
}

/** The file, once, when any test body in it lacks its markers or has them out of order. */
export function aaaViolations(file: string, text: string): string[] {
  const { calls, source } = parseTestFile(file, text);
  const broken = calls.some((c) => c.body && !aaaInOrder(aaaMarkers(file, text, c.body, source)));
  return broken ? [file] : [];
}

describe("test hygiene rules apply as specified", () => {
  it.each([
    ['it.only("a", () => { expect(1).toBe(1); });', ["x.spec.ts: it.only"]],
    ['describe.skip("s", () => {});', ["x.spec.ts: describe.skip"]],
    ['it.todo("later");', ["x.spec.ts: it.todo"]],
    ['fit("a", () => {}); xdescribe("s", () => {});', ["x.spec.ts: fit", "x.spec.ts: xdescribe"]],
    ['it.skip.each([[1]])("a %s", () => {});', ["x.spec.ts: it.skip.each"]],
    ['it.each([[1]])("a %s", () => { expect(1).toBe(1); });', []],
    ['const s = "it.only(";', []],
  ])("focus/skip: %j → %j", (text, expected) => {
    // Act & Assert
    expect(focusSkipViolations("x.spec.ts", text)).toEqual(expected);
  });

  it.each([
    ['it("a", () => { const x = 1; });', ["x.spec.ts: a"]],
    ['it("a", () => { expect(1).toBe(1); });', []],
    ['it("a", async () => { await expect(p).rejects.toThrow(); });', []],
    ['it("a", () => { expectAllowlisted("r", []); });', []],
    ['it("a", () => { expect.assertions(1); });', []],
    ["it(`t ${x}`, () => {});", ["x.spec.ts: (line 1)"]],
  ])("assertions: %j → %j", (text, expected) => {
    // Act & Assert
    expect(assertionViolations("x.spec.ts", text)).toEqual(expected);
  });

  it.each([
    ["it(\"a\", () => {\n  // Arrange\n  const x = 1;\n\n  // Act\n  const y = x;\n\n  // Assert\n  expect(y).toBe(1);\n});", []],
    ["it(\"a\", () => {\n  // Act & Assert\n  expect(1).toBe(1);\n});", []],
    ["it(\"a\", () => {\n  // Act\n  f();\n  // Assert\n  expect(1).toBe(1);\n});", []],
    ["it(\"a\", () => {\n  // Assert\n  expect(LIMIT).toBe(5);\n});", []],
    ["it(\"a\", () => {\n  expect(1).toBe(1);\n});", ["x.spec.ts"]],
    ["it(\"a\", () => {\n  // Assert\n  expect(1).toBe(1);\n  // Act\n  f();\n});", ["x.spec.ts"]],
    ["it(\"a\", () => {\n  // Act & Assert\n  expect(1).toBe(1);\n  // Assert\n  expect(2).toBe(2);\n});", ["x.spec.ts"]],
    ["describe(\"s\", () => {\n  it.todo(\"later\");\n});", []],
  ])("markers: %j → %j", (text, expected) => {
    // Act & Assert
    expect(aaaViolations("x.spec.ts", text)).toEqual(expected);
  });
});

describe("test hygiene", () => {
  const files = testFiles();

  it("commits no focused, skipped or todo test", () => {
    // Act & Assert
    expectAllowlisted("test-focus-skip", files.flatMap((f) => focusSkipViolations(f, readSource(f))));
  });

  it("asserts something in every test body", () => {
    // Act & Assert
    expectAllowlisted("test-assertions", files.flatMap((f) => assertionViolations(f, readSource(f))));
  });

  it("marks Arrange / Act / Assert in every test body of a file not yet reworked", () => {
    // Act & Assert
    expectAllowlisted("test-aaa", files.flatMap((f) => aaaViolations(f, readSource(f))));
  });
});
