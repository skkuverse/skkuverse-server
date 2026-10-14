/**
 * A one-letter name only inside a callback of three lines or fewer
 * (`.claude/rules/naming.md`): `(b) => b.campus` reads at a glance, while a
 * `b` that lives for fifteen lines, or a function parameter `o`, makes the
 * reader carry the type in their head.
 *
 * In a module scope's non-spec sources, a one-letter variable, parameter,
 * destructured binding or function name is allowed only:
 *
 *   - in the parameters of an arrow or function expression passed as a call's
 *     argument whose text spans at most three lines;
 *   - as the counter a `for (let i = …; …; …)` statement declares;
 *   - as the key name of an index signature (`[k: string]: unknown`).
 *
 * `_` (an ignored parameter) is not a name. A name used beyond these that the
 * module has a reason to keep is exempt in `exemptions/short-names.json`.
 */
import ts from "typescript";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const MAX_CALLBACK_LINES = 3;

function declaredName(node: ts.Node): string | undefined {
  const isDeclaration =
    ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isBindingElement(node);
  return isDeclaration && node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
}

/** The parameter list a declaration sits in, through any destructuring. */
function enclosingParameter(node: ts.Node): ts.ParameterDeclaration | undefined {
  for (let n: ts.Node = node; ; n = n.parent) {
    if (ts.isParameter(n)) return n;
    if (!(ts.isBindingElement(n) || ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))) return undefined;
  }
}

function isShortCallbackParameter(node: ts.Node, sf: ts.SourceFile): boolean {
  const parameter = enclosingParameter(node);
  if (!parameter) return false;
  if (ts.isIndexSignatureDeclaration(parameter.parent)) return true;
  const fn = parameter.parent;
  if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || !ts.isCallExpression(fn.parent)) return false;
  const lines = sf.getLineAndCharacterOfPosition(fn.getEnd()).line - sf.getLineAndCharacterOfPosition(fn.getStart(sf)).line + 1;
  return lines <= MAX_CALLBACK_LINES;
}

const isLoopCounter = (node: ts.Node): boolean =>
  ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isForStatement(node.parent.parent);

/** `<file>: <name> (line <n>)` for each one-letter name outside the places the docblock allows. */
export function shortNameViolations(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    const name = declaredName(node);
    if (name !== undefined && name.length === 1 && name !== "_" && !isShortCallbackParameter(node, sf) && !isLoopCounter(node)) {
      out.push(`${file}: ${name} (line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("short name rule applies as specified", () => {
  const file = "src/x/x.mapper.ts";

  it("allows a one-letter parameter of a short callback, destructured or not, a loop counter and an index key", () => {
    // Arrange
    const source = [
      "const ids = xs.map((b) => b.id);",
      "const keys = Object.entries(o2).map(([k, v]) => `${k}=${v}`);",
      "const sum = xs.reduce((a, b) => {",
      "  return a + b;",
      "});",
      "for (let i = 0; i < 3; i++) use(i);",
      "type Bag = { [k: string]: unknown };",
      "const ignored = xs.map((_) => 1);",
    ].join("\n");

    // Act & Assert
    expect(shortNameViolations(file, source)).toEqual([]);
  });

  it("refuses a one-letter variable, function parameter, long callback parameter, loop binding and function", () => {
    // Arrange
    const source = [
      "const c = getClient();",
      "function windowIssues(o: Option, index: number): string[] { return []; }",
      "const overlays = markers.flatMap((m) => {",
      "  const base = toBase(m);",
      "  const more = 1;",
      "  return [base];",
      "});",
      "for (const [key, v] of Object.entries(bag)) use(key, v);",
      "function t(key: string): string { return key; }",
    ].join("\n");

    // Act
    const violations = shortNameViolations(file, source);

    // Assert
    expect(violations).toEqual([
      `${file}: c (line 1)`,
      `${file}: o (line 2)`,
      `${file}: m (line 3)`,
      `${file}: v (line 8)`,
      `${file}: t (line 9)`,
    ]);
  });
});

describe("names in the module scopes", () => {
  it("are one letter only in short callbacks", () => {
    // Arrange
    const files = sourceFiles().filter((f) => moduleScopes().some((scope) => inScope(f, scope)));

    // Act
    const violations = files.flatMap((f) => shortNameViolations(f, readSource(f)).map((v) => v.replace(/ \(line \d+\)$/, "")));

    // Assert
    expectExempted("short-names", [...new Set(violations)]);
  });
});
