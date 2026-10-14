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
 * function expression, exported in place or through `export { … }`;
 * parentheses, `as` and `satisfies` around it are seen through, and so is a
 * call that wraps it (`memoize((x) => …)`). A `.constants` export also fails
 * when it is a class, holds code (an object of functions,
 * `Object.freeze(() => …)`) or is named as a predicate; a `.schema` export
 * fails when it re-exports a predicate by name or is an object with a
 * predicate member. Specs are not checked.
 *
 * The rule is strict: no allowlist, and no list may hold an entry under src/
 * (scope-entries.test.ts).
 *
 * A class role holds its class: in a module scope, a `.service`,
 * `.controller`, `.repository`, `.client` or `.poller` file declares no
 * top-level function, exported or not: no `function`, and no constant that
 * holds code (an arrow, an object of methods, a lookup table of arrows, a call
 * wrapping a function), and no second class. A decision goes to `.rules`, a reshape
 * to `.mapper`, Mongo syntax to `.query`, and a helper only the class uses
 * becomes its private method. Constants and types may sit beside the class.
 */
import ts from "typescript";
import { collect, exportsOf, isExported, isFunctionExpression, parseSource, skipOuter, type ExportedBinding } from "../helpers/architecture/ast";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "role-contents";
const PREDICATE_NAME = /^(?:is|has|can|needs|should)[A-Z]/;

interface ExportedFunction {
  name: string;
  returnType: ts.TypeNode | undefined;
}

/** A node that is, or carries, code: a function, an arrow, a method or a class. */
const isCode = (n: ts.Node): boolean =>
  isFunctionExpression(n) || ts.isMethodDeclaration(n) || ts.isClassExpression(n) || ts.isClassDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);

/** Whether a node holds code anywhere inside it: `{ of(doc) {…} }`, `Object.freeze(() => 1)`, `memoize((x) => …)`. */
const holdsCode = (node: ts.Node): boolean => collect(node, (n): n is ts.Node => isCode(n)).length > 0;

/** The function an exported binding is: a declaration, or a variable bound to a (wrapped) function, alone or as a call's argument. */
function asFunction(b: ExportedBinding): ExportedFunction | undefined {
  if (b.kind === "function" && b.declaration && ts.isFunctionDeclaration(b.declaration)) return { name: b.exported, returnType: b.declaration.type };
  const value = b.initializer;
  if (value === undefined) return undefined;
  if (isFunctionExpression(value)) return { name: b.exported, returnType: value.type };
  if (ts.isCallExpression(value)) {
    const wrapped = value.arguments.map(skipOuter).find(isFunctionExpression);
    if (wrapped) return { name: b.exported, returnType: wrapped.type };
  }
  return undefined;
}

/**
 * The functions a source exports, directly or through `export { … }`, each once (an overloaded function by
 * its implementation's name). Parentheses, `as` and `satisfies` around a function are seen through.
 */
export function exportedFunctions(file: string, source: string): ExportedFunction[] {
  return exportsOf(parseSource(file, source)).bindings.flatMap((b) => {
    const fn = b.isType ? undefined : asFunction(b);
    return fn ? [fn] : [];
  });
}

const isBooleanType = (type: ts.TypeNode | undefined): boolean =>
  type !== undefined && (type.kind === ts.SyntaxKind.BooleanKeyword || ts.isTypePredicateNode(type));

const isPredicate = (fn: ExportedFunction): boolean => PREDICATE_NAME.test(fn.name) || isBooleanType(fn.returnType);

/** `<file>: function <name>` for each export of a `.constants` source that is or holds code, or is named as a predicate. */
function constantsViolations(file: string, bindings: readonly ExportedBinding[]): string[] {
  return bindings
    .filter((b) => !b.isType)
    .filter((b) => {
      if (b.kind === "function" || b.kind === "class" || PREDICATE_NAME.test(b.exported)) return true;
      const node = b.initializer ?? (b.kind === "default" ? b.declaration : undefined);
      return node !== undefined && holdsCode(node);
    })
    .map((b) => `${file}: function ${b.exported}`);
}

/** The predicates a `.schema` source exports: functions by name or return type, re-exports by name, and an object's predicate members. */
function schemaPredicates(file: string, bindings: readonly ExportedBinding[]): string[] {
  return bindings.flatMap((b) => {
    if (b.isType) return [];
    if (b.kind === "reexport") return PREDICATE_NAME.test(b.exported) ? [`${file}: predicate ${b.exported}`] : [];
    const fn = asFunction(b);
    if (fn) return isPredicate(fn) ? [`${file}: predicate ${fn.name}`] : [];
    if (PREDICATE_NAME.test(b.exported)) return [`${file}: predicate ${b.exported}`];
    const value = b.initializer;
    if (value === undefined || !ts.isObjectLiteralExpression(value)) return [];
    return value.properties.flatMap((p) => {
      const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined;
      const member = ts.isPropertyAssignment(p) ? skipOuter(p.initializer) : p;
      const returnType = isFunctionExpression(member) || ts.isMethodDeclaration(member) ? member.type : undefined;
      const isFn = isFunctionExpression(member) || ts.isMethodDeclaration(member);
      return isFn && name !== undefined && (PREDICATE_NAME.test(name) || isBooleanType(returnType)) ? [`${file}: predicate ${b.exported}.${name}`] : [];
    });
  });
}

/** `<file>: <problem>` for a `.rules`, `.constants` or `.schema` source that holds what its role does not. */
export function roleContentViolations(file: string, source: string): string[] {
  if (!file.startsWith("src/") || file.endsWith(".spec.ts")) return [];
  const role = parse(file).parts.at(-1);
  if (role !== "rules" && role !== "constants" && role !== "schema") return [];
  const { bindings } = exportsOf(parseSource(file, source));
  if (role === "rules") return exportedFunctions(file, source).length === 0 ? [`${file}: exports no function`] : [];
  if (role === "constants") return constantsViolations(file, bindings);
  return schemaPredicates(file, bindings);
}

const CLASS_ROLES_WITHOUT_FUNCTIONS = new Set(["service", "controller", "repository", "client", "poller"]);

/**
 * `<file>: top-level function <name>` for each top-level declaration of a class-role source that is or holds code
 * (a function, an arrow, an object of methods, a call wrapping a function), and `<file>: second class <name>` for
 * each class beside the exported one.
 */
export function classRoleFunctionViolations(file: string, source: string): string[] {
  if (!file.startsWith("src/") || file.endsWith(".spec.ts")) return [];
  if (!CLASS_ROLES_WITHOUT_FUNCTIONS.has(parse(file).parts.at(-1) ?? "")) return [];
  const sf = parseSource(file, source);
  const out: string[] = [];
  const classes = sf.statements.filter(ts.isClassDeclaration);
  const main = classes.find(isExported) ?? classes[0];
  for (const s of sf.statements) {
    if (ts.isClassDeclaration(s)) {
      if (s !== main) out.push(`${file}: second class ${s.name?.text ?? "(anonymous)"}`);
    } else if (ts.isFunctionDeclaration(s) && s.name) {
      if (s.body) out.push(`${file}: top-level function ${s.name.text}`);
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (d.initializer && holdsCode(d.initializer)) out.push(`${file}: top-level function ${d.name.getText(sf)}`);
      }
    }
  }
  return out;
}

describe("role contents rule applies as specified", () => {
  it.each([
    ["a .rules function declaration", "src/x/x.rules.ts", "export function toX(n: number): number { return n; }"],
    ["a .rules arrow", "src/x/x.rules.ts", "export const isX = (n: number): boolean => n > 1;"],
    ["a .rules function exported through export { … }", "src/x/x.rules.ts", "const MAX = 3;\nfunction toX(): number { return MAX; }\nexport { MAX, toX };"],
    ["a .rules file with constants beside its function", "src/x/x.rules.ts", "export const MAX_X = 3;\nexport function toX(): number { return MAX_X; }"],
    ["a .rules function wrapped in a call", "src/x/x.rules.ts", "export const toX = memoize((n: number): number => n);"],
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
    ["a .constants arrow in parentheses", "src/x/x.constants.ts", "export const isAutoRotateSec = ((sec: number): boolean => sec === 0);", ["function isAutoRotateSec"]],
    ["a .constants arrow behind satisfies", "src/x/x.constants.ts", "export const toX = ((n: number): number => n) satisfies (n: number) => number;", ["function toX"]],
    ["a .constants arrow behind as", "src/x/x.constants.ts", "export const toX = ((n: number) => n) as (n: number) => number;", ["function toX"]],
    ["a .constants class", "src/x/x.constants.ts", "export class X { static f(): number { return 1; } }", ["function X"]],
    ["a .constants object of functions", "src/x/x.constants.ts", "export const FNS = { a: (n: number) => n > 1 };", ["function FNS"]],
    ["a .constants frozen function", "src/x/x.constants.ts", "export const F = Object.freeze(() => 1);", ["function F"]],
    ["a .constants default function", "src/x/x.constants.ts", "export default function f(): number { return 1; }", ["function default"]],
    ["a .constants value named as a predicate", "src/x/x.constants.ts", "export const isX = check;", ["function isX"]],
    ["a .schema predicate in parentheses", "src/x/x.schema.ts", "export const isX = ((n: number): boolean => n > 1);", ["predicate isX"]],
    ["a .schema predicate behind as", "src/x/x.schema.ts", "export const isX = ((n: number): boolean => n > 1) as (n: number) => boolean;", ["predicate isX"]],
    ["a .schema predicate re-exported", "src/x/x.schema.ts", 'export { isX } from "./x.rules";', ["predicate isX"]],
    ["a .schema object with a predicate member", "src/x/x.schema.ts", "export const checks = { isX: (n: number): boolean => n > 1 };", ["predicate checks.isX"]],
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
    ["an object of methods", "src/x/x.service.ts", "const reasons = { of(doc: unknown) { return String(doc); } };\nexport class XService {}", ["reasons"]],
    ["a lookup table of arrows", "src/x/x.repository.ts", "const UPSERT_BY_SOURCE = { a: (d: unknown) => d, b: (d: unknown) => d };\nexport class XRepository {}", ["UPSERT_BY_SOURCE"]],
    ["a call-wrapped arrow", "src/x/x.service.ts", "const reasonOf = memoize((doc: unknown) => String(doc));\nexport class XService {}", ["reasonOf"]],
    ["a parenthesised arrow", "src/x/x.client.ts", "const toX = ((n: number) => n);\nexport class XClient {}", ["toX"]],
  ])("fails %s", (_case, file, source, names) => {
    // Act & Assert
    expect(classRoleFunctionViolations(file, source)).toEqual(names.map((name) => `${file}: top-level function ${name}`));
  });

  it("fails a second class beside the role's class", () => {
    // Arrange
    const source = "class Reason { static of(doc: unknown): string { return String(doc); } }\nexport class XService {}";

    // Act & Assert
    expect(classRoleFunctionViolations("src/x/x.service.ts", source)).toEqual(["src/x/x.service.ts: second class Reason"]);
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

describe("class-role files in the module scopes", () => {
  it("declare no function beside their class", () => {
    // Arrange
    const files = filesUnder("src").filter((f) => f.endsWith(".ts") && moduleScopes().some((scope) => inScope(f, scope)));

    // Act
    const violations = files.flatMap((f) => classRoleFunctionViolations(f, readSource(f)));

    // Assert
    expectExempted("class-role-functions", violations);
  });
});
