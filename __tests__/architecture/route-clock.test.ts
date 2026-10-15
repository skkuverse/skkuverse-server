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
 * (or the testing module's `.overrideProvider(Clock)` chain, or its `providers`)
 * holds `{ provide: Clock, … }`. A module is Clock-dependent when it provides
 * `Clock`, provides a class whose constructor takes a `Clock` (by name, through
 * `useClass`, or as a factory's `inject`), or imports such a module.
 *
 * The rule fails closed (PR 234 D2): it reads `imports` through casts and
 * parentheses, a variable assigned in the same file, spreads, and
 * `appModulesUnder(…)` (`__tests__/helpers/nest/app-modules.ts`); a boot whose
 * options or imports it cannot resolve that way fails, override or not.
 */
import ts from "typescript";
import { calleeName, collect, parseSource, skipOuter } from "../helpers/architecture/ast";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { filesUnder, readSource, sourceFiles } from "../helpers/architecture/tree";
import { APP_MODULE_FILE, appModuleImportsUnder } from "../helpers/nest/app-modules";

const names = (e: ts.Expression | undefined): string[] =>
  e !== undefined && ts.isArrayLiteralExpression(e) ? e.elements.flatMap((x) => (ts.isIdentifier(x) ? [x.text] : [])) : [];

const property = (o: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined => {
  const p = o.properties.find((x) => x.name !== undefined && ts.isIdentifier(x.name) && x.name.text === key);
  if (p !== undefined && ts.isShorthandPropertyAssignment(p)) return p.name;
  return p !== undefined && ts.isPropertyAssignment(p) ? p.initializer : undefined;
};

/** What a provider entry names: `X`, or the `provide`, `useClass`, `useExisting` and `inject` of `{ provide: X, … }`. */
function providerNames(e: ts.Expression): string[] {
  const x = skipOuter(e);
  if (ts.isIdentifier(x)) return [x.text];
  if (!ts.isObjectLiteralExpression(x)) return [];
  const one = (key: string): string[] => {
    const v = property(x, key);
    return v !== undefined && ts.isIdentifier(skipOuter(v)) ? [(skipOuter(v) as ts.Identifier).text] : [];
  };
  const inject = property(x, "inject");
  return [...one("provide"), ...one("useClass"), ...one("useExisting"), ...names(inject && skipOuter(inject))];
}

const providerList = (e: ts.Expression | undefined): string[] =>
  e !== undefined && ts.isArrayLiteralExpression(skipOuter(e)) ? (skipOuter(e) as ts.ArrayLiteralExpression).elements.flatMap(providerNames) : [];

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
        modules.set(name, { imports: names(property(metadata, "imports")), providers: providerList(property(metadata, "providers")) });
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

/** The expressions a file assigns to `name`: `const name = …` and `name = …`. */
function assignedTo(sf: ts.SourceFile, name: string): ts.Expression[] {
  const declared = collect(sf, ts.isVariableDeclaration).flatMap((d) =>
    ts.isIdentifier(d.name) && d.name.text === name && d.initializer !== undefined ? [d.initializer] : [],
  );
  const assigned = collect(sf, ts.isBinaryExpression).flatMap((b) =>
    b.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(b.left) && b.left.text === name ? [b.right] : [],
  );
  return [...declared, ...assigned];
}

interface ListItems {
  items: ts.Expression[];
  /** Module names an `appModulesUnder(…)` call stands for. */
  modules: string[];
  unresolved: string[];
}

/** The entries of a list expression, through casts, spreads, same-file variables and `appModulesUnder(…)`. */
function listItems(sf: ts.SourceFile, expression: ts.Expression, appModuleSource: () => string, seen: ReadonlySet<string> = new Set()): ListItems {
  const e = skipOuter(expression);
  const out: ListItems = { items: [], modules: [], unresolved: [] };
  const merge = (r: ListItems): void => {
    out.items.push(...r.items);
    out.modules.push(...r.modules);
    out.unresolved.push(...r.unresolved);
  };
  if (ts.isArrayLiteralExpression(e)) {
    for (const element of e.elements) {
      if (ts.isSpreadElement(element)) merge(listItems(sf, element.expression, appModuleSource, seen));
      else out.items.push(skipOuter(element));
    }
  } else if (ts.isCallExpression(e) && calleeName(e) === "appModulesUnder" && e.arguments.every(ts.isStringLiteralLike)) {
    const folders = e.arguments.map((a) => (a as ts.StringLiteralLike).text);
    out.modules.push(...appModuleImportsUnder(appModuleSource(), folders).map((m) => m.name));
  } else if (ts.isIdentifier(e) && !seen.has(e.text) && assignedTo(sf, e.text).length > 0) {
    for (const value of assignedTo(sf, e.text)) merge(listItems(sf, value, appModuleSource, new Set([...seen, e.text])));
  } else {
    out.unresolved.push(e.getText(sf));
  }
  return out;
}

const isClockIdentifier = (e: ts.Expression | undefined): boolean => e !== undefined && ts.isIdentifier(skipOuter(e)) && (skipOuter(e) as ts.Identifier).text === "Clock";

/** `{ provide: Clock, … }`, written in place or bound to a same-file variable. */
function isClockOverride(sf: ts.SourceFile, e: ts.Expression): boolean {
  const x = skipOuter(e);
  if (ts.isObjectLiteralExpression(x)) return isClockIdentifier(property(x, "provide"));
  return ts.isIdentifier(x) && assignedTo(sf, x.text).some((value) => value !== e && isClockOverride(sf, value));
}

const readAppModule = (): string => readSource(APP_MODULE_FILE);

/**
 * `<file>:<line>` for each app a test builds from a Clock-dependent module without overriding Clock, and
 * `<file>:<line> cannot resolve <what>` for a boot whose options or imports the rule cannot read.
 */
export function unpinnedClockApps(file: string, source: string, clockModules: ReadonlySet<string>, appModuleSource: () => string = readAppModule): string[] {
  const sf = parseSource(file, source);
  return collect(sf, ts.isCallExpression).flatMap((call) => {
    const callee = call.expression;
    const isBuild = ts.isIdentifier(callee) && callee.text === "buildTestApp";
    const isTesting = ts.isPropertyAccessExpression(callee) && callee.name.text === "createTestingModule" && callee.expression.getText(sf) === "Test";
    if (!(isBuild || isTesting)) return [];
    const at = `${file}:${sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1}`;
    const options = call.arguments[0] === undefined ? undefined : skipOuter(call.arguments[0]);
    if (options === undefined || !ts.isObjectLiteralExpression(options) || options.properties.some(ts.isSpreadAssignment)) {
      return [`${at} cannot resolve the options ${options?.getText(sf) ?? "(none)"}`];
    }
    const importsExpression = property(options, "imports");
    if (importsExpression === undefined) return [];
    const imports = listItems(sf, importsExpression, appModuleSource);
    const unresolved = [...imports.unresolved, ...imports.items.filter((i) => !ts.isIdentifier(i)).map((i) => i.getText(sf))];
    if (unresolved.length > 0) return [`${at} cannot resolve the imports ${unresolved.join(", ")}`];
    const booted = [...imports.items.map((i) => (i as ts.Identifier).text), ...imports.modules];
    if (!booted.some((m) => clockModules.has(m))) return [];
    let chain: ts.Node = call;
    while (ts.isPropertyAccessExpression(chain.parent) || ts.isCallExpression(chain.parent)) chain = chain.parent;
    const overridesIn = (e: ts.Expression | undefined): boolean => e !== undefined && listItems(sf, e, appModuleSource).items.some((i) => isClockOverride(sf, i));
    const overridden = isBuild
      ? overridesIn(property(options, "overrides"))
      : overridesIn(property(options, "providers")) ||
        collect(chain, ts.isCallExpression).some((c) => calleeName(c) === "overrideProvider" && isClockIdentifier(c.arguments[0]));
    return overridden ? [] : [at];
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

describe("route clock rule fails closed on the spellings it must resolve", () => {
  const sources = new Map([
    ["src/x/x.service.ts", "export class XService { constructor(private readonly clock: Clock) {} }"],
    ["src/x/x.module.ts", "@Module({ providers: [XService] })\nexport class XModule {}"],
    ["src/y/y.module.ts", "@Module({ imports: [XModule] })\nexport class YModule {}"],
    ["src/w/w.module.ts", "@Module({ providers: [WService] })\nexport class WModule {}"],
    ["src/u/u.module.ts", "@Module({ providers: [{ provide: UService, useClass: XService }] })\nexport class UModule {}"],
    ["src/v/v.module.ts", '@Module({ providers: [{ provide: "TOKEN", useFactory: (c) => c, inject: [Clock] }] })\nexport class VModule {}'],
  ]);
  const appModule = [
    'import { XModule } from "./x/x.module";',
    'import { YModule } from "./y/y.module";',
    'import { WModule } from "./w/w.module";',
    "@Module({ imports: [XModule, YModule, WModule] })",
    "export class AppModule {}",
  ].join("\n");
  const file = "__tests__/nest/ui/ui.routes.test.ts";
  const check = (...lines: string[]): string[] => unpinnedClockApps(file, lines.join("\n"), clockDependentModules(sources), () => appModule);

  it("counts a provider object's useClass and a factory's inject", () => {
    // Act
    const modules = clockDependentModules(sources);

    // Assert
    expect(modules.has("UModule")).toBe(true);
    expect(modules.has("VModule")).toBe(true);
  });

  it.each([
    ["a cast", ["app = await buildTestApp({ imports: [YModule] as never[] });"]],
    ["parentheses and satisfies", ["app = await buildTestApp({ imports: ([YModule] satisfies unknown[]) });"]],
    ["a shorthand bound to an array", ["const imports = [WModule, YModule];", "app = await buildTestApp({ imports });"]],
    ["a variable assigned later, behind a cast", ["let modules: unknown[];", "modules = [YModule];", "app = await buildTestApp({ imports: modules as never[] });"]],
    ["a spread", ["const base = [YModule];", "app = await buildTestApp({ imports: [...base, WModule] });"]],
    ["appModulesUnder", ['app = await buildTestApp({ imports: appModulesUnder("src/y/") });']],
  ])("flags an unpinned boot through %s", (_case, lines) => {
    // Act
    const violations = check(...lines);

    // Assert
    expect(violations).toEqual([`${file}:${lines.length}`]);
  });

  it.each([
    ["a cast", ["app = await buildTestApp({ imports: [YModule] as never[], overrides: [{ provide: Clock, useValue: clock }] });"]],
    ["an override bound to a variable", ["const pinned = { provide: Clock, useValue: clock };", "app = await buildTestApp({ imports: [YModule], overrides: [pinned] });"]],
    ["an overrides list bound to a variable", ["const overrides = [{ provide: Clock, useValue: clock }];", "app = await buildTestApp({ imports: [YModule], overrides });"]],
    ["appModulesUnder", ['app = await buildTestApp({ imports: appModulesUnder("src/y/", "src/w/"), overrides: [{ provide: Clock, useValue: clock }] });']],
    ["appModulesUnder over modules that read no clock", ['app = await buildTestApp({ imports: appModulesUnder("src/w/") });']],
  ])("passes a boot through %s", (_case, lines) => {
    // Act & Assert
    expect(check(...lines)).toEqual([]);
  });

  it.each([
    ["options in a variable", ["app = await buildTestApp(options);"], "cannot resolve the options options"],
    ["options with a spread", ["app = await buildTestApp({ ...base, overrides: [{ provide: Clock, useValue: clock }] });"], "cannot resolve the options"],
    ["imports from a call", ["app = await buildTestApp({ imports: load(), overrides: [{ provide: Clock, useValue: clock }] });"], "cannot resolve the imports load()"],
    ["an import that is not a class name", ["app = await buildTestApp({ imports: [forwardRef(() => WModule)] });"], "cannot resolve the imports forwardRef(() => WModule)"],
    ["an unbound identifier", ["app = await buildTestApp({ imports: modules });"], "cannot resolve the imports modules"],
  ])("fails a boot it cannot resolve: %s, override or not", (_case, lines, message) => {
    // Act
    const violations = check(...lines);

    // Assert
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`${file}:${lines.length} ${message}`);
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
