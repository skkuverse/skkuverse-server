/**
 * Routes as Nest declares them: `@Controller(prefix)` on a class and
 * `@Get(path)` (or another HTTP method decorator) on its methods, read from the
 * source. Shared by the rate-limit coverage, route-order, scope-entries and
 * wire-routes rules.
 */
import ts from "typescript";

const HTTP_METHODS = new Set(["Get", "Post", "Put", "Delete", "Patch", "All", "Options", "Head"]);

export interface Route {
  controller: string;
  method: string;
  path: string;
}

export interface RouteHandler extends Route {
  handler: ts.MethodDeclaration;
}


export const join = (...parts: string[]) =>
  parts
    .flatMap((p) => p.split("/"))
    .filter(Boolean)
    .join("/");

function decoratorCall(d: ts.Decorator): { name: string; args: readonly ts.Expression[] } | undefined {
  const e = d.expression;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    return { name: e.expression.text, args: e.arguments };
  }
  return undefined;
}

/** A string literal, or a `{ path: "..." }` object; `undefined` means "not statically known". */
export function pathArg(arg: ts.Expression | undefined): string | undefined {
  if (arg === undefined) return "";
  if (ts.isStringLiteralLike(arg)) return arg.text;
  if (ts.isObjectLiteralExpression(arg)) {
    for (const p of arg.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "path") {
        return ts.isStringLiteralLike(p.initializer) ? p.initializer.text : undefined;
      }
    }
    return "";
  }
  return undefined;
}

/** Routes declared in one file, each with its handler method. A path that is not a literal throws: the rule cannot check it. */
export function routeHandlersIn(file: string, source: string): RouteHandler[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const routes: RouteHandler[] = [];
  for (const cls of sf.statements.filter(ts.isClassDeclaration)) {
    const ctrl = ts
      .getDecorators(cls)
      ?.map(decoratorCall)
      .find((d) => d?.name === "Controller");
    if (!ctrl || !cls.name) continue;
    const prefix = pathArg(ctrl.args[0]);
    if (prefix === undefined) throw new Error(`${file}: @Controller path is not a literal`);
    for (const member of cls.members.filter(ts.isMethodDeclaration)) {
      for (const d of ts.getDecorators(member) ?? []) {
        const call = decoratorCall(d);
        if (!call || !HTTP_METHODS.has(call.name)) continue;
        const sub = pathArg(call.args[0]);
        if (sub === undefined) throw new Error(`${file}: @${call.name} path is not a literal`);
        routes.push({
          controller: cls.name.text,
          method: call.name.toUpperCase(),
          path: join(prefix, sub),
          handler: member,
        });
      }
    }
  }
  return routes;
}

/** Routes declared in one file. A path that is not a literal throws: the rule cannot check it. */
export function routesIn(file: string, source: string): Route[] {
  return routeHandlersIn(file, source).map(({ controller, method, path }) => ({ controller, method, path }));
}

