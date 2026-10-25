/**
 * The raw body is captured only on the paths in `RAW_BODY_ROUTE_PATHS` (ADR 0023, D6), and a handler that hands
 * `rawBody` to a push call reads undefined anywhere else, so every POST would be unverifiable. Every handler under
 * src/ that reads `rawBody` is on a listed path, and every listed path has such a handler, so the list neither
 * misses a signed route nor keeps bytes no handler reads.
 */
import ts from "typescript";
import { RAW_BODY_ROUTE_PATHS } from "../../src/miniapps/notifications/miniapps-notifications.constants";
import { collect } from "../helpers/architecture/ast";
import { routeHandlersIn } from "../helpers/architecture/routes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const readsRawBody = (handler: ts.MethodDeclaration): boolean =>
  collect(handler, (n): n is ts.PropertyAccessExpression => ts.isPropertyAccessExpression(n) && n.name.text === "rawBody").length > 0;

/** `<METHOD> /<path>` of each handler in `source` that reads `rawBody`. */
export function rawBodyHandlers(file: string, source: string): string[] {
  return routeHandlersIn(file, source)
    .filter(({ handler }) => readsRawBody(handler))
    .map(({ method, path }) => `${method} /${path}`);
}

const pathOf = (route: string): string => route.slice(route.indexOf(" ") + 1);

describe("raw body routes", () => {
  const routes = sourceFiles()
    .filter((file) => file.endsWith(".controller.ts"))
    .flatMap((file) => rawBodyHandlers(file, readSource(file)));

  it("lists the path of every handler that reads rawBody", () => {
    // Act
    const unlisted = routes.filter((route) => !RAW_BODY_ROUTE_PATHS.includes(pathOf(route)));

    // Assert
    expect(unlisted).toEqual([]);
  });

  it("lists no path whose handlers never read rawBody", () => {
    // Act
    const unread = RAW_BODY_ROUTE_PATHS.filter((path) => !routes.some((route) => pathOf(route) === path));

    // Assert
    expect(unread).toEqual([]);
  });

  it.each([
    ["a handler that reads req.rawBody", "send(@Req() req) { return req.rawBody; }", ["POST /x/:id/run"]],
    ["a handler that destructures nothing of it", "send(@Req() req) { return req.body; }", []],
  ])("reads %s", (_case, body, expected) => {
    // Arrange
    const source = `@Controller("x") export class XController { @Post(":id/run") ${body} }`;

    // Act & Assert
    expect(rawBodyHandlers("src/x/x.controller.ts", source)).toEqual(expected);
  });
});
