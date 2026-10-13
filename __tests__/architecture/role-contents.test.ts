/**
 * A role file holds what its role names (ADR 0010, D4): a `.rules` file
 * decides or computes, so it exports at least one function; a `.constants`
 * file holds values, so it exports no function; a `.schema` file holds zod
 * schemas, their types and parse helpers, so it exports no predicate (a
 * function named `is…`, `has…`, `can…`, `needs…` or `should…`, or one
 * declared to return a boolean or a type predicate). A decision a schema
 * needs is a refinement inside it or a function in `.rules`.
 *
 * A function is a `function` declaration, or a `const` bound to an arrow or
 * function expression, exported in place or through `export { … }`. A
 * re-export from another file is not read. Specs are not checked.
 *
 * The allowlist holds the files of modules not yet migrated; a migrated scope
 * carries no entry (migrated-scopes.test.ts).
 *
 * A class role holds its class: in a migrated scope, a `.service`,
 * `.controller`, `.repository`, `.client` or `.poller` file declares no
 * top-level function, exported or not. A decision goes to `.rules`, a reshape
 * to `.mapper`, Mongo syntax to `.query`, and a helper only the class uses
 * becomes its private method. Constants and types may sit beside the class.
 */
import ts from "typescript";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, migratedScopes } from "../helpers/architecture/migrated";
import { parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "role-contents";
const PREDICATE_NAME = /^(?:is|has|can|needs|should)[A-Z]/;

interface ExportedFunction {
  name: string;
  returnType: ts.TypeNode | undefined;
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const isFunctionValue = (node: ts.Expression | undefined): node is ts.ArrowFunction | ts.FunctionExpression =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

function localFunction(node: ts.Statement): ExportedFunction[] {
  if (ts.isFunctionDeclaration(node) && node.name) return [{ name: node.name.text, returnType: node.type }];
  if (!ts.isVariableStatement(node)) return [];
  return node.declarationList.declarations.flatMap((d) =>
    ts.isIdentifier(d.name) && isFunctionValue(d.initializer) ? [{ name: d.name.text, returnType: d.initializer.type }] : [],
  );
}

/** The local names an `export { … }` without `from` lists, keyed by the local name, valued by the exported one. */
function exportClauseNames(sf: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const s of sf.statements) {
    if (!ts.isExportDeclaration(s) || s.isTypeOnly || s.moduleSpecifier || !s.exportClause) continue;
    if (!ts.isNamedExports(s.exportClause)) continue;
    for (const e of s.exportClause.elements) if (!e.isTypeOnly) names.set((e.propertyName ?? e.name).text, e.name.text);
  }
  return names;
}

/**
 * The functions a source exports, directly or through `export { … }`, each once (an overloaded function by
 * its implementation's name).
 */
export function exportedFunctions(file: string, source: string): ExportedFunction[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const viaClause = exportClauseNames(sf);
  const found = new Map<string, ExportedFunction>();
  for (const s of sf.statements) {
    for (const fn of localFunction(s)) {
      const exportedAs = isExported(s) ? fn.name : viaClause.get(fn.name);
      if (exportedAs !== undefined) found.set(exportedAs, { ...fn, name: exportedAs });
    }
  }
  return [...found.values()];
}

const isBooleanType = (type: ts.TypeNode | undefined): boolean =>
  type !== undefined && (type.kind === ts.SyntaxKind.BooleanKeyword || ts.isTypePredicateNode(type));

const isPredicate = (fn: ExportedFunction): boolean => PREDICATE_NAME.test(fn.name) || isBooleanType(fn.returnType);

/** `<file>: <problem>` for a `.rules`, `.constants` or `.schema` source that holds what its role does not. */
export function roleContentViolations(file: string, source: string): string[] {
  if (!file.startsWith("src/") || file.endsWith(".spec.ts")) return [];
  const role = parse(file).parts.at(-1);
  if (role !== "rules" && role !== "constants" && role !== "schema") return [];
  const functions = exportedFunctions(file, source);
  if (role === "rules") return functions.length === 0 ? [`${file}: exports no function`] : [];
  if (role === "constants") return functions.map((fn) => `${file}: function ${fn.name}`);
  return functions.filter(isPredicate).map((fn) => `${file}: predicate ${fn.name}`);
}

const CLASS_ROLES_WITHOUT_FUNCTIONS = new Set(["service", "controller", "repository", "client", "poller"]);

/** `<file>: top-level function <name>` for each function a class-role source declares beside its class. */
export function classRoleFunctionViolations(file: string, source: string): string[] {
  if (!file.startsWith("src/") || file.endsWith(".spec.ts")) return [];
  if (!CLASS_ROLES_WITHOUT_FUNCTIONS.has(parse(file).parts.at(-1) ?? "")) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sf.statements.flatMap(localFunction).map((fn) => `${file}: top-level function ${fn.name}`);
}

describe("role contents rule applies as specified", () => {
  it.each([
    ["a .rules function declaration", "src/x/x.rules.ts", "export function toX(n: number): number { return n; }"],
    ["a .rules arrow", "src/x/x.rules.ts", "export const isX = (n: number): boolean => n > 1;"],
    ["a .rules function exported through export { … }", "src/x/x.rules.ts", "const MAX = 3;\nfunction toX(): number { return MAX; }\nexport { MAX, toX };"],
    ["a .rules file with constants beside its function", "src/x/x.rules.ts", "export const MAX_X = 3;\nexport function toX(): number { return MAX_X; }"],
    ["a .constants file of values", "src/x/x.constants.ts", 'export const MAX_X = 3;\nexport const X_KINDS = ["a"] as const;\nconst local = () => 1;'],
    ["a .constants object whose values are not functions", "src/x/x.constants.ts", "export const LIMITS = { min: 1, max: 2 };"],
    ["a .schema of schemas, types and a parse helper", "src/x/x.schema.ts", [
      'import { z } from "zod";',
      "export const xFile = z.object({ n: z.number().refine((n) => n > 1) });",
      "export type XRaw = z.output<typeof xFile>;",
      "export function parseX(raw: unknown): XRaw { return xFile.parse(raw); }",
      "export const toXRaw = (raw: unknown): XRaw => xFile.parse(raw);",
    ].join("\n")],
    ["a .schema predicate that is not exported", "src/x/x.schema.ts", "function isX(n: number): boolean { return n > 1; }"],
    ["a spec", "src/x/x.constants.spec.ts", "export function isX(): boolean { return true; }"],
    ["another role", "src/x/x.mapper.ts", "export const X = 1;"],
    ["a file outside src/", "scripts/x.constants.ts", "export function f(): void {}"],
  ])("passes %s", (_case, file, source) => {
    // Act & Assert
    expect(roleContentViolations(file, source)).toEqual([]);
  });

  it.each([
    ["a .rules file of constants only", "src/x/x.rules.ts", 'export const MAX_X = 3;\nexport const X_KINDS = ["a"] as const;', ["exports no function"]],
    ["a .rules file whose function is not exported", "src/x/y/x-y.rules.ts", "export const MAX = 3;\nfunction isX(): boolean { return true; }", ["exports no function"]],
    ["a .constants function declaration", "src/x/x.constants.ts", "export const MIN = 2;\nexport function isX(n: number): boolean { return n >= MIN; }", ["function isX"]],
    ["a .constants arrow and function expression", "src/x/x.constants.ts", "export const a = () => 1;\nexport const b = function () { return 2; };", ["function a", "function b"]],
    ["a .constants function exported through export { … }, renamed", "src/x/x.constants.ts", "const a = () => 1;\nexport { a as b };", ["function b"]],
    ["a .schema predicate by name", "src/x/x.schema.ts", "export function hasX(raw: unknown) { return raw !== null; }", ["predicate hasX"]],
    ["a .schema predicate by return type", "src/x/x.schema.ts", "export const checkX = (n: number): boolean => n > 1;", ["predicate checkX"]],
    ["a .schema type predicate", "src/x/x.schema.ts", "export function asX(v: unknown): v is string { return typeof v === 'string'; }", ["predicate asX"]],
  ])("fails %s", (_case, file, source, problems) => {
    // Act & Assert
    expect(roleContentViolations(file, source)).toEqual(problems.map((p) => `${file}: ${p}`));
  });

  it("counts an overloaded function once", () => {
    // Arrange
    const source = "export function isX(n: number): boolean;\nexport function isX(n: unknown): boolean { return true; }";

    // Act & Assert
    expect(roleContentViolations("src/x/x.schema.ts", source)).toEqual(["src/x/x.schema.ts: predicate isX"]);
  });
});

describe("src/ .rules, .constants and .schema files", () => {
  it("hold what their role names", () => {
    // Arrange
    const files = filesUnder("src").filter((f) => f.endsWith(".ts"));

    // Act & Assert
    expectAllowlisted(RULE, files.flatMap((f) => roleContentViolations(f, readSource(f))));
  });
});

describe("class role rule applies as specified", () => {
  it.each([
    ["a function declaration beside a service", "src/x/x.service.ts", "function reasonOf(): string { return ''; }\nexport class XService {}", ["reasonOf"]],
    ["an exported arrow beside a controller", "src/x/x.controller.ts", "export const parseId = (raw: string) => Number(raw);\nexport class XController {}", ["parseId"]],
    ["an arrow beside a repository", "src/x/x.repository.ts", "const idOf = (doc: unknown) => String(doc);\nexport class XRepository {}", ["idOf"]],
  ])("fails %s", (_case, file, source, names) => {
    // Act & Assert
    expect(classRoleFunctionViolations(file, source)).toEqual(names.map((name) => `${file}: top-level function ${name}`));
  });

  it.each([
    ["constants and types beside the class", "src/x/x.client.ts", "const URL = 'https://x';\ntype Raw = { a: 1 };\nexport class XClient { private toX() { return 1; } }"],
    ["a function in another role", "src/x/x.rules.ts", "export function toX(): number { return 1; }"],
    ["a spec", "src/x/x.service.spec.ts", "function arrange(): void {}"],
  ])("passes %s", (_case, file, source) => {
    // Act & Assert
    expect(classRoleFunctionViolations(file, source)).toEqual([]);
  });
});

describe("class-role files in migrated scopes", () => {
  it("declare no function beside their class", () => {
    // Arrange
    const files = filesUnder("src").filter((f) => f.endsWith(".ts") && migratedScopes().some((scope) => inScope(f, scope)));

    // Act
    const violations = files.flatMap((f) => classRoleFunctionViolations(f, readSource(f)));

    // Assert
    expectExempted("class-role-functions", violations);
  });
});
