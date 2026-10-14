/**
 * A route test pins the instant it runs at (`.claude/rules/tests.md`, "What
 * to double"; PR 229 F6). The ESLint block `specs/fixed-clock` refuses
 * `new Clock()` in a spec, but a route test gets the real Clock from Nest
 * whenever it boots a module that provides or injects it, and its answer then
 * depends on the day it runs.
 *
 * In a module scope's tests (`__tests__/nest/<module>/`), each
 * `buildTestApp({ imports })` or `Test.createTestingModule({ imports })` whose
 * imports reach a Clock-dependent module overrides `Clock`: its `overrides`
 * (or the testing module's `.overrideProvider(…)` chain, or its `providers`)
 * names `Clock`. A module is Clock-dependent when it provides `Clock`, provides
 * a class whose constructor takes a `Clock`, or imports such a module.
 */
import ts from "typescript";
import { collect, parseSource } from "../helpers/architecture/ast";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { filesUnder, readSource, sourceFiles } from "../helpers/architecture/tree";

const names = (e: ts.Expression | undefined): string[] =>
  e !== undefined && ts.isArrayLiteralExpression(e) ? e.elements.flatMap((x) => (ts.isIdentifier(x) ? [x.text] : [])) : [];

const property = (o: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined => {
  const p = o.properties.find((x) => x.name !== undefined && ts.isIdentifier(x.name) && x.name.text === key);
  return p !== undefined && ts.isPropertyAssignment(p) ? p.initializer : undefined;
};

const mentionsClock = (node: ts.Node | undefined): boolean =>
  node !== undefined && collect(node, ts.isIdentifier).some((i) => i.text === "Clock");

/** The Nest modules of `sources` that reach `Clock`, by class name. */
export function clockDependentModules(sources: ReadonlyMap<string, string>): Set<string> {
  const injectsClock = new Set<string>();
  const modules = new Map<string, { imports: string[]; providers: string[] }>();
  for (const [file, source] of sources) {
    for (const cls of parseSource(file, source).statements.filter(ts.isClassDeclaration)) {
      const name = cls.name?.text;
      if (name === undefined) continue;
      const ctor = cls.members.find(ts.isConstructorDeclaration);
      if (ctor?.parameters.some((p) => p.type !== undefined && ts.isTypeReferenceNode(p.type) && p.type.typeName.getText() === "Clock")) injectsClock.add(name);
      const decorator = (ts.getDecorators(cls) ?? []).find((d) => ts.isCallExpression(d.expression) && d.expression.expression.getText() === "Module");
      const metadata = decorator && ts.isCallExpression(decorator.expression) ? decorator.expression.arguments[0] : undefined;
      if (metadata !== undefined && ts.isObjectLiteralExpression(metadata)) {
        modules.set(name, { imports: names(property(metadata, "imports")), providers: names(property(metadata, "providers")) });
      }
    }
  }
  const memo = new Map<string, boolean>();
  const reaches = (module: string): boolean => {
    if (memo.has(module)) return memo.get(module)!;
    memo.set(module, false);
    const m = modules.get(module);
    const result = m !== undefined && (m.providers.some((p) => p === "Clock" || injectsClock.has(p)) || m.imports.some(reaches));
    memo.set(module, result);
    return result;
  };
  return new Set([...modules.keys()].filter(reaches));
}

/** `<file>:<line>` for each app a test builds from a Clock-dependent module without overriding Clock. */
export function unpinnedClockApps(file: string, source: string, clockModules: ReadonlySet<string>): string[] {
  const sf = parseSource(file, source);
  return collect(sf, ts.isCallExpression).flatMap((call) => {
    const callee = call.expression;
    const isBuild = ts.isIdentifier(callee) && callee.text === "buildTestApp";
    const isTesting = ts.isPropertyAccessExpression(callee) && callee.name.text === "createTestingModule" && callee.expression.getText(sf) === "Test";
    const options = call.arguments[0];
    if (!(isBuild || isTesting) || options === undefined || !ts.isObjectLiteralExpression(options)) return [];
    if (!names(property(options, "imports")).some((m) => clockModules.has(m))) return [];
    let chain: ts.Node = call;
    while (ts.isPropertyAccessExpression(chain.parent) || ts.isCallExpression(chain.parent)) chain = chain.parent;
    const overridden = isBuild ? mentionsClock(property(options, "overrides")) : mentionsClock(property(options, "providers")) || mentionsClock(chain);
    return overridden ? [] : [`${file}:${sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1}`];
  });
}

describe("route clock rule applies as specified", () => {
  const sources = new Map([
    ["src/x/x.service.ts", "export class XService { constructor(private readonly clock: Clock) {} }"],
    ["src/x/x.module.ts", "@Module({ providers: [XService] })\nexport class XModule {}"],
    ["src/y/y.module.ts", "@Module({ imports: [XModule] })\nexport class YModule {}"],
    ["src/z/z.module.ts", "@Module({ providers: [ZService, Clock] })\nexport class ZModule {}"],
    ["src/w/w.module.ts", "@Module({ providers: [WService] })\nexport class WModule {}"],
  ]);

  it("finds the modules that provide or inject Clock, directly or through an import", () => {
    // Act & Assert
    expect([...clockDependentModules(sources)].sort()).toEqual(["XModule", "YModule", "ZModule"]);
  });

  it("flags an app built from such a module without a Clock override, and passes one with it", () => {
    // Arrange
    const test = [
      "app = await buildTestApp({ imports: [YModule], overrides: [{ provide: XRepository, useValue: repo }] });",
      "app = await buildTestApp({ imports: [YModule], overrides: [{ provide: Clock, useValue: clock }] });",
      "app = await buildTestApp({ imports: [WModule] });",
      "const ref = await Test.createTestingModule({ imports: [ZModule] }).compile();",
      "const ok = await Test.createTestingModule({ imports: [ZModule] }).overrideProvider(Clock).useValue(clock).compile();",
    ].join("\n");

    // Act
    const violations = unpinnedClockApps("__tests__/nest/ui/ui.routes.test.ts", test, clockDependentModules(sources));

    // Assert
    expect(violations).toEqual(["__tests__/nest/ui/ui.routes.test.ts:1", "__tests__/nest/ui/ui.routes.test.ts:4"]);
  });
});

describe("route tests in the module scopes", () => {
  it("override Clock when they boot a module that reads it", () => {
    // Arrange
    const sources = new Map(sourceFiles().map((f) => [f, readSource(f)]));
    const clockModules = clockDependentModules(sources);
    const tests = filesUnder("__tests__/nest").filter((f) => f.endsWith(".ts") && moduleScopes().some((scope) => inScope(f, scope)));

    // Act
    const violations = tests.flatMap((f) => unpinnedClockApps(f, readSource(f), clockModules));

    // Assert
    expect(clockModules.size).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
