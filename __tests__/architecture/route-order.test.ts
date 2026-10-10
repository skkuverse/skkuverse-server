/**
 * A static route is registered before a parameter route that would catch it
 * (ADR 0010, D3).
 *
 * Express answers with the first route that matches, and Nest registers
 * routes module by module in scan order: depth first from `AppModule`, a
 * module before its imports, each module once (`scanForModules` in
 * `@nestjs/core/scanner.js`), then each module's controllers in order and each
 * controller's handlers in declaration order. So when a sub-module shares its
 * parent's URL prefix, `/building/:skkuId` registered first would answer
 * `GET /building/search` with a 400. This rule replays that order from the
 * source and fails when an earlier route's pattern matches a later route.
 */
import ts from "typescript";
import { routesIn, type Route } from "../helpers/architecture/routes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

interface ModuleDecl {
  imports: string[];
  controllers: string[];
}

/** The class name an `imports` entry refers to: `XModule` or `XModule.forRoot(…)`. */
function importedName(e: ts.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression)) {
    return e.expression.expression.text;
  }
  return undefined;
}

/** `@Module({ imports, controllers })` classes by name. */
export function moduleDecls(sources: ReadonlyArray<{ file: string; source: string }>): Map<string, ModuleDecl> {
  const out = new Map<string, ModuleDecl>();
  for (const { file, source } of sources) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    for (const cls of sf.statements.filter(ts.isClassDeclaration)) {
      for (const d of ts.getDecorators(cls) ?? []) {
        const call = d.expression;
        if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "Module") continue;
        const arg = call.arguments[0];
        const decl: ModuleDecl = { imports: [], controllers: [] };
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const p of arg.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || !ts.isArrayLiteralExpression(p.initializer)) continue;
            const names = p.initializer.elements.flatMap((e) => importedName(e) ?? []);
            if (p.name.text === "imports") decl.imports = names;
            if (p.name.text === "controllers") decl.controllers = names;
          }
        }
        if (cls.name) out.set(cls.name.text, decl);
      }
    }
  }
  return out;
}

/** Routes in the order Nest registers them, starting from `root`. */
export function registrationOrder(root: string, modules: ReadonlyMap<string, ModuleDecl>, routes: readonly Route[]): Route[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string): void => {
    const decl = modules.get(name);
    if (!decl || seen.has(name)) return;
    seen.add(name);
    order.push(name);
    decl.imports.forEach(visit);
  };
  visit(root);
  return order.flatMap((m) => modules.get(m)!.controllers.flatMap((c) => routes.filter((r) => r.controller === c)));
}

/** Whether `pattern` (with `:param` and `*rest` segments) matches the path of `route`. */
function matches(pattern: string, path: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith("*")) return true;
    if (i >= s.length || (!p[i]!.startsWith(":") && p[i] !== s[i])) return false;
  }
  return p.length === s.length;
}

/** `<METHOD> <path> after <earlier path>` for each route an earlier one catches. */
export function shadowedRoutes(ordered: readonly Route[]): string[] {
  const out: string[] = [];
  ordered.forEach((later, j) => {
    const earlier = ordered
      .slice(0, j)
      .find((r) => (r.method === later.method || r.method === "ALL") && matches(r.path, later.path));
    if (earlier) out.push(`${later.method} ${later.path} after ${earlier.path}`);
  });
  return out;
}

describe("route order rule applies as specified", () => {
  const CONTROLLERS = `
@Controller("building")
export class BuildingController {
  @Get("list") list() {}
  @Get(":skkuId") detail() {}
}
@Controller("building")
export class BuildingSearchController {
  @Get("search") search() {}
}`;
  const routes = routesIn("x.controller.ts", CONTROLLERS);
  const app = (imports: string) => `
@Module({ controllers: [BuildingController] }) export class BuildingModule {}
@Module({ imports: [BuildingModule], controllers: [BuildingSearchController] }) export class BuildingSearchModule {}
@Module({ imports: [BuildingModule] }) export class MapModule {}
@Module({ imports: [ConfigModule.forRoot(), ${imports}] }) export class AppModule {}`;
  const order = (imports: string) =>
    shadowedRoutes(registrationOrder("AppModule", moduleDecls([{ file: "x.module.ts", source: app(imports) }]), routes));

  it("passes when the sub-module on the shared prefix is registered first", () => {
    expect(order("BuildingSearchModule, BuildingModule, MapModule")).toEqual([]);
  });

  it("fails when the parent, directly or through another module, comes first", () => {
    expect(order("BuildingModule, BuildingSearchModule")).toEqual(["GET building/search after building/:skkuId"]);
    expect(order("MapModule, BuildingSearchModule")).toEqual(["GET building/search after building/:skkuId"]);
  });

  it("matches parameter, wildcard and literal segments", () => {
    const r = (method: string, path: string): Route => ({ controller: "C", method, path });
    expect(
      shadowedRoutes([r("GET", "notices/:sourceId/:articleNo"), r("GET", "notices/proxy/attachment"), r("POST", "notices/a/b")]),
    ).toEqual(["GET notices/proxy/attachment after notices/:sourceId/:articleNo"]);
    expect(shadowedRoutes([r("GET", "notices/source/:id"), r("GET", "notices/overview")])).toEqual([]);
  });
});

describe("routes", () => {
  it("register static paths before the parameter paths that would catch them", () => {
    const files = sourceFiles();
    const read = (f: string) => ({ file: f, source: readSource(f) });
    const modules = moduleDecls(files.filter((f) => f.endsWith(".module.ts")).map(read));
    const routes = files.flatMap((f) => routesIn(f, readSource(f)));
    const ordered = registrationOrder("AppModule", modules, routes);
    expect(ordered.length).toBe(routes.length);
    expect(shadowedRoutes(ordered)).toEqual([]);
  });
});
