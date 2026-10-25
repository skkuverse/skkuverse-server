/**
 * Every handler of an `internal/` route asks INTERNAL_AUTHORIZER before it runs (ADR 0023, D8): it carries
 * `@InternalRoute(<scope>)` with a scope of `INTERNAL_SCOPES` on the handler itself, which sets the scope and binds
 * `InternalScopeGuard` in one decorator, so a new internal route without it fails here instead of answering anyone.
 */
import ts from "typescript";
import { INTERNAL_SCOPES } from "../../src/perimeter/perimeter.ports";
import { routeHandlersIn } from "../helpers/architecture/routes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const SCOPES: ReadonlySet<string> = new Set(INTERNAL_SCOPES);

const isInternalRoute = (handler: ts.MethodDeclaration): boolean =>
  (ts.getDecorators(handler) ?? [])
    .map((d) => d.expression)
    .some((e) => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "InternalRoute" && isDeclaredScope(e.arguments[0]));

const isDeclaredScope = (scope: ts.Expression | undefined): boolean => scope !== undefined && ts.isStringLiteral(scope) && SCOPES.has(scope.text);

/** `<file>: <METHOD> /<path>` for each internal handler without `@InternalRoute(<declared scope>)`. */
export function unscopedInternalHandlers(file: string, source: string): string[] {
  return routeHandlersIn(file, source)
    .filter(({ path }) => path === "internal" || path.startsWith("internal/"))
    .filter(({ handler }) => !isInternalRoute(handler))
    .map(({ method, path }) => `${file}: ${method} /${path}`);
}

describe("internal scopes", () => {
  it("put @InternalRoute on every internal handler under src/", () => {
    // Act
    const unscoped = sourceFiles()
      .filter((file) => file.endsWith(".controller.ts"))
      .flatMap((file) => unscopedInternalHandlers(file, readSource(file)));

    // Assert
    expect(unscoped).toEqual([]);
  });

  it.each([
    ["no decorator", "", ["src/x/x.controller.ts: POST /internal/x/run"]],
    ["a scope the ports do not declare", '@InternalRoute("x.run")', ["src/x/x.controller.ts: POST /internal/x/run"]],
    ["no scope", "@InternalRoute()", ["src/x/x.controller.ts: POST /internal/x/run"]],
    ["a declared scope", '@InternalRoute("notices.dispatch")', []],
  ])("reads a handler with %s", (_case, decorators, expected) => {
    // Arrange
    const source = `@Controller("internal/x") export class XController { ${decorators} @Post("run") run() {} }`;

    // Act & Assert
    expect(unscopedInternalHandlers("src/x/x.controller.ts", source)).toEqual(expected);
  });

  it("leaves a public route alone", () => {
    // Arrange
    const source = `@Controller("x") export class XController { @Get("internal") read() {} }`;

    // Act & Assert
    expect(unscopedInternalHandlers("src/x/x.controller.ts", source)).toEqual([]);
  });
});
