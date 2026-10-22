/**
 * Reads test files the way Jest runs them, for the rules that guard the tests
 * themselves (ADR 0011, D8): which calls are tests or suites,
 * which are focused, skipped or todo, what each test body asserts, and its
 * Arrange / Act / Assert markers. The TypeScript parser finds the calls, so a
 * name inside a string or a comment is never mistaken for one.
 */
import ts from "typescript";
import { commentsOf } from "./comments";
import { filesUnder } from "./tree";

const TEST_NAMES = new Set(["it", "test", "fit", "xit", "xtest"]);
const SUITE_NAMES = new Set(["describe", "fdescribe", "xdescribe"]);
const MODIFIERS = new Set(["only", "skip", "todo", "concurrent", "failing"]);
const FOCUSED_ALIASES = new Set(["fit", "fdescribe"]);
const SKIPPED_ALIASES = new Set(["xit", "xtest", "xdescribe"]);

export interface TestCall {
  kind: "test" | "suite";
  /** As written: `it`, `it.only`, `it.each`, `xdescribe`, … */
  callee: string;
  focused: boolean;
  skipped: boolean;
  /** The title when it is a plain string, else null (a template or an expression). */
  title: string | null;
  line: number;
  /** The test body, or null for `it.todo` and a suite. */
  body: ts.ArrowFunction | ts.FunctionExpression | null;
}

export interface ParsedTestFile {
  calls: TestCall[];
  /** `expect(…)` calls in the whole file, helpers included. */
  expectCalls: number;
  source: ts.SourceFile;
}

/** Every test file Jest collects: `__tests__/**\/*.test.ts` outside helpers and fixtures, and `src/**\/*.spec.ts`. */
export function testFiles(): string[] {
  const underTests = filesUnder("__tests__").filter(
    (f) =>
      f.endsWith(".test.ts") && !f.startsWith("__tests__/helpers/") && !f.startsWith("__tests__/architecture/fixtures/"),
  );
  const specs = filesUnder("src").filter((f) => f.endsWith(".spec.ts"));
  return [...underTests, ...specs].sort();
}

/** The identifiers of a callee, outermost last: `it.only.each` → ["it", "only", "each"]. */
function calleeParts(expression: ts.Expression): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const base = calleeParts(expression.expression);
    return base ? [...base, expression.name.text] : null;
  }
  return null;
}

function isFunction(node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function toTestCall(call: ts.CallExpression, source: ts.SourceFile): TestCall | null {
  // `it.each(table)("title", fn)`: the callee is itself a call to `<name>.each`.
  const eachCall = ts.isCallExpression(call.expression) ? call.expression : null;
  const parts = calleeParts(eachCall ? eachCall.expression : call.expression);
  if (!parts) return null;
  const [name, ...rest] = parts as [string, ...string[]];
  const isTest = TEST_NAMES.has(name);
  if (!isTest && !SUITE_NAMES.has(name)) return null;
  if (eachCall ? rest[rest.length - 1] !== "each" : rest.includes("each")) return null;
  const modifiers = eachCall ? rest.slice(0, -1) : rest;
  if (!modifiers.every((m) => MODIFIERS.has(m))) return null;

  const [titleArg, bodyArg] = call.arguments;
  return {
    kind: isTest ? "test" : "suite",
    callee: [...parts].join("."),
    focused: FOCUSED_ALIASES.has(name) || modifiers.includes("only"),
    skipped: SKIPPED_ALIASES.has(name) || modifiers.includes("skip") || modifiers.includes("todo"),
    title: titleArg && ts.isStringLiteralLike(titleArg) ? titleArg.text : null,
    line: source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1,
    body: isTest && isFunction(bodyArg) ? bodyArg : null,
  };
}

export function parseTestFile(file: string, text: string): ParsedTestFile {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: TestCall[] = [];
  let expectCalls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "expect") expectCalls++;
      const call = toTestCall(node, source);
      if (call) calls.push(call);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { calls, expectCalls, source };
}

/**
 * A body asserts when it calls `expect…` or `assert…`, directly or through a
 * helper named so (`expectAllowlisted`), or awaits `expect(…).rejects`.
 */
export function bodyAsserts(body: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const parts = calleeParts(node.expression);
      if (parts && /^(expect|assert)/.test(parts[0]!)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

const MARKER = /^\/\/ (Arrange|Act|Assert|Act & Assert)$/;

/** The step markers inside a body, in order. */
export function aaaMarkers(file: string, text: string, body: ts.Node, source: ts.SourceFile): string[] {
  const first = source.getLineAndCharacterOfPosition(body.getStart(source)).line + 1;
  const last = source.getLineAndCharacterOfPosition(body.getEnd()).line + 1;
  return commentsOf(file, text)
    .filter((c) => c.kind === "line" && c.ownLine && c.line > first && c.line <= last)
    .map((c) => c.raw.trim().match(MARKER)?.[1])
    .filter((m): m is string => !!m);
}

/**
 * Arrange? then Act? then Assert, or Act & Assert, each once (tests.md). Act may
 * be absent when it ran in a shared setup or there is none, as for a constant.
 */
export function aaaInOrder(markers: readonly string[]): boolean {
  return /^(Arrange,)?((Act,)?Assert|Act & Assert)$/.test(markers.join(","));
}
