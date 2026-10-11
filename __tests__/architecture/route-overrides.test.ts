/**
 * A route test replaces only what leaves the process or reads the time
 * (harden-test-suite D2, D11, task 4.4): every provider it overrides is imported
 * from a `*.repository`, `*.client` or `*.poller` file, or is the poller registry
 * (tests.md: a poller's double is a spy on it) or the Clock. Overriding a
 * service, a controller or a config stubs the code the route test exists to run.
 *
 * A route test is a test file, or a `__tests__/helpers/nest/` builder, that boots
 * an app: it calls `buildTestApp`, a `build<Module>App` builder or
 * `createNestApplication`. Its overrides are every `{ provide: X, use… }` object
 * in it, passed to a builder, kept in a variable or listed in a stub module, and
 * every `.override<Kind>(X)` call on a testing module builder. `jest.mock` of a
 * module is not covered.
 */
import path from "path";
import ts from "typescript";
import { parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { testFiles } from "../helpers/architecture/tests";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "route-overrides";
const BUILDERS_DIR = "__tests__/helpers/nest";
const DOUBLE_ROLES = new Set(["repository", "client", "poller"]);
/** `<file>#<export>` of the tokens a route test may override whatever their file's role. */
const DOUBLE_TOKENS = new Set(["src/infra/clock.ts#Clock", "src/scheduling/poller-registry.service.ts#PollerRegistryService"]);
const PROVIDER_KEYS = new Set(["useValue", "useClass", "useFactory", "useExisting"]);
const OVERRIDE_CALLS = new Set([
  "overrideProvider",
  "overrideGuard",
  "overrideInterceptor",
  "overrideFilter",
  "overridePipe",
  "overrideModule",
]);

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function bootsApp(name: string): boolean {
  return name === "buildTestApp" || name === "createNestApplication" || /^build[A-Z]\w*App$/.test(name);
}

function propertyName(p: ts.ObjectLiteralElementLike): string | null {
  return p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
}

/** The `provide` of an object with a `use…` key, or null when the object is no provider. */
function providedToken(node: ts.ObjectLiteralExpression): ts.Expression | null {
  const names = node.properties.map(propertyName);
  if (!names.some((n) => n !== null && PROVIDER_KEYS.has(n))) return null;
  const provide = node.properties.find((p) => propertyName(p) === "provide");
  if (!provide) return null;
  return ts.isPropertyAssignment(provide) ? provide.initializer : (provide.name as ts.Identifier);
}

function unwrap(expression: ts.Expression): ts.Expression {
  let e = expression;
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}

/** Local name → `<repo path>.ts#<export>`, or the package specifier for a non-relative import. */
function importsOf(file: string, source: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of source.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause) continue;
    const spec = s.moduleSpecifier.text;
    const from = spec.startsWith(".") ? `${path.posix.join(path.posix.dirname(file), spec)}.ts` : spec;
    const clause = s.importClause;
    if (clause.name) out.set(clause.name.text, `${from}#default`);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const e of clause.namedBindings.elements) {
        out.set(e.name.text, `${from}#${(e.propertyName ?? e.name).text}`);
      }
    }
  }
  return out;
}

function isDouble(origin: string): boolean {
  if (DOUBLE_TOKENS.has(origin)) return true;
  const [file] = origin.split("#") as [string];
  return file.endsWith(".ts") && DOUBLE_ROLES.has(parse(file).parts.at(-1) ?? "");
}

/** `<file>: <token> (<origin>)` for each overridden token that is no repository, client, poller or clock. */
export function routeOverrideViolations(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tokens: ts.Expression[] = [];
  let boots = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && bootsApp(name)) boots = true;
      const [arg] = node.arguments;
      // A builder's `overrideProvider(o.provide)` loop: the `{ provide }` objects it reads are counted where written.
      if (name && OVERRIDE_CALLS.has(name) && arg && ts.isIdentifier(unwrap(arg))) tokens.push(unwrap(arg));
    }
    if (ts.isObjectLiteralExpression(node)) {
      const token = providedToken(node);
      if (token) tokens.push(unwrap(token));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!boots) return [];

  const imports = importsOf(file, source);
  const violations = tokens.flatMap((token) => {
    const name = token.getText(source);
    const origin = ts.isIdentifier(token) ? imports.get(token.text) : undefined;
    if (origin === undefined) return [`${file}: ${name} (not imported)`];
    return isDouble(origin) ? [] : [`${file}: ${name} (${origin.replace(/#.*$/, "")})`];
  });
  return [...new Set(violations)].sort();
}

describe("route overrides rule applies as specified", () => {
  const FILE = "__tests__/nest/bus/schedule.routes.test.ts";
  const routeTest = (imports: string, overrides: string): string =>
    `${imports}\nimport { buildTestApp } from "../../helpers/nest/build-test-app";\n` +
    `beforeAll(async () => { app = await buildTestApp({ imports: [BusModule], overrides: [${overrides}] }); });\n`;

  it.each([
    [
      "a repository",
      routeTest(`import { BusRepository } from "../../../src/bus/bus.repository";`, "{ provide: BusRepository, useValue: fake }"),
      [],
    ],
    [
      "a client in a sub-module",
      routeTest(
        `import { HsscClient } from "../../../src/bus/realtime/hssc.client";`,
        "{ provide: HsscClient, useValue: asReal(fake) }",
      ),
      [],
    ],
    [
      "a poller",
      routeTest(`import { HsscPoller } from "../../../src/bus/hssc.poller";`, "{ provide: HsscPoller, useValue: {} }"),
      [],
    ],
    [
      "the Clock",
      routeTest(`import { Clock } from "../../../src/infra/clock";`, "{ provide: Clock, useValue: clock }"),
      [],
    ],
    [
      "the poller registry",
      routeTest(
        `import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";`,
        "{ provide: PollerRegistryService, useValue: registry }",
      ),
      [],
    ],
    [
      "a service",
      routeTest(`import { BusService } from "../../../src/bus/bus.service";`, "{ provide: BusService, useValue: {} }"),
      [`${FILE}: BusService (src/bus/bus.service.ts)`],
    ],
    [
      "a service through useClass",
      routeTest(`import { BusService } from "../../../src/bus/bus.service";`, "{ provide: BusService, useClass: Stub }"),
      [`${FILE}: BusService (src/bus/bus.service.ts)`],
    ],
    [
      "a service imported under another name",
      routeTest(`import { BusService as Bus } from "../../../src/bus/bus.service";`, "{ provide: Bus, useValue: {} }"),
      [`${FILE}: Bus (src/bus/bus.service.ts)`],
    ],
    [
      "a class named Clock from another file",
      routeTest(`import { Clock } from "../../../src/bus/clock";`, "{ provide: Clock, useValue: {} }"),
      [`${FILE}: Clock (src/bus/clock.ts)`],
    ],
    [
      "a token declared in the test",
      routeTest("const TOKEN = Symbol();", "{ provide: TOKEN, useValue: {} }"),
      [`${FILE}: TOKEN (not imported)`],
    ],
    [
      "a string token",
      routeTest("", `{ provide: "BUS", useValue: {} }`),
      [`${FILE}: "BUS" (not imported)`],
    ],
    [
      "overrideProvider on a testing module",
      `import { BusService } from "../../../src/bus/bus.service";\n` +
        "const ref = await Test.createTestingModule({ imports: [BusModule] }).overrideProvider(BusService).useValue({}).compile();\n" +
        "const app = ref.createNestApplication();\n",
      [`${FILE}: BusService (src/bus/bus.service.ts)`],
    ],
    [
      "an older builder's override array, kept in a variable",
      `import { BusService } from "../../../src/bus/bus.service";\n` +
        "const overrides = [{ provide: BusService, useValue: {} }];\n" +
        "beforeAll(async () => { app = await buildBusApp(overrides); });\n",
      [`${FILE}: BusService (src/bus/bus.service.ts)`],
    ],
    [
      "a stub module's provider",
      `import { BusService } from "../../../src/bus/bus.service";\n` +
        "@Module({ providers: [{ provide: BusService, useValue: {} }], exports: [BusService] }) class Stub {}\n" +
        "beforeAll(async () => { app = await buildTestApp({ imports: [Stub] }); });\n",
      [`${FILE}: BusService (src/bus/bus.service.ts)`],
    ],
    [
      "a builder's loop over its override specs",
      "for (const o of overrides) builder.overrideProvider(o.provide as never).useValue(o.useValue);\n" +
        "const app = moduleRef.createNestApplication(adapter);\n",
      [],
    ],
    [
      "a service spec that boots no app",
      `import { BusService } from "../../../src/bus/bus.service";\n` +
        "const ref = await Test.createTestingModule({ providers: [{ provide: BusService, useValue: {} }] }).compile();\n",
      [],
    ],
    [
      "provide named only in a comment or a string",
      routeTest("// { provide: BusService, useValue: {} }", "") + `const s = "{ provide: BusService, useValue: {} }";\n`,
      [],
    ],
  ])("%s", (_case, text, expected) => {
    // Act & Assert
    expect(routeOverrideViolations(FILE, text)).toEqual(expected);
  });
});

describe("route overrides", () => {
  it("replace only repositories, clients, pollers and the clock in a route test", () => {
    // Arrange
    const files = [...testFiles(), ...filesUnder(BUILDERS_DIR).filter((f) => f.endsWith(".ts"))];

    // Act
    const violations = files.flatMap((f) => routeOverrideViolations(f, readSource(f)));

    // Assert
    expectAllowlisted(RULE, violations);
  });
});
