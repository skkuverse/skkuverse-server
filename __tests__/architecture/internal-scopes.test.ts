/**
 * Every handler of an `internal/` route asks INTERNAL_AUTHORIZER before it runs (ADR 0023, D8): it carries
 * `@InternalScope(<scope>)` with a scope of `INTERNAL_SCOPES` and `@UseGuards(InternalScopeGuard)`, both on the
 * handler itself, so a new internal route without them fails here instead of answering anyone.
 */
import ts from "typescript";
import { INTERNAL_SCOPES } from "../../src/perimeter/perimeter.ports";
import { routeHandlersIn } from "../helpers/architecture/routes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const SCOPES: ReadonlySet<string> = new Set(INTERNAL_SCOPES);

function decoratorCalls(handler: ts.MethodDeclaration, name: string): ts.CallExpression[] {
  return (ts.getDecorators(handler) ?? [])
    .map((d) => d.expression)
    .filter((e): e is ts.CallExpression => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === name);
}

const isScoped = (handler: ts.MethodDeclaration): boolean =>
  decoratorCalls(handler, "InternalScope").some(({ arguments: [scope] }) => scope !== undefined && ts.isStringLiteral(scope) && SCOPES.has(scope.text));

const isGuarded = (handler: ts.MethodDeclaration): boolean =>
  decoratorCalls(handler, "UseGuards").some((call) => call.arguments.some((guard) => ts.isIdentifier(guard) && guard.text === "InternalScopeGuard"));

/** `<file>: <METHOD> /<path>` for each internal handler missing its scope or its guard. */
export function unscopedInternalHandlers(file: string, source: string): string[] {
  return routeHandlersIn(file, source)
    .filter(({ path }) => path === "internal" || path.startsWith("internal/"))
    .filter(({ handler }) => !isScoped(handler) || !isGuarded(handler))
    .map(({ method, path }) => `${file}: ${method} /${path}`);
}

describe("internal scopes", () => {
  it("put @InternalScope and InternalScopeGuard on every internal handler under src/", () => {
    // Act
    const unscoped = sourceFiles()
      .filter((file) => file.endsWith(".controller.ts"))
      .flatMap((file) => unscopedInternalHandlers(file, readSource(file)));

    // Assert
    expect(unscoped).toEqual([]);
  });

  it.each([
    ["no decorator", "", ["src/x/x.controller.ts: POST /internal/x/run"]],
    ["the scope alone", '@InternalScope("notices.dispatch")', ["src/x/x.controller.ts: POST /internal/x/run"]],
    ["the guard alone", "@UseGuards(InternalScopeGuard)", ["src/x/x.controller.ts: POST /internal/x/run"]],
    ["a scope the ports do not declare", '@InternalScope("x.run") @UseGuards(InternalScopeGuard)', ["src/x/x.controller.ts: POST /internal/x/run"]],
    ["both", '@InternalScope("notices.dispatch") @UseGuards(InternalScopeGuard)', []],
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
