/**
 * Every route is rate-limited or explicitly exempt (ADR 0010, D7).
 *
 * Limiters are middleware bound in a module's `configure()`:
 * `consumer.apply(XRateLimitMiddleware).forRoutes(...)`. A middleware counts as
 * a limiter when its class name ends in `RateLimitMiddleware`. A `forRoutes`
 * argument is a path string (Nest mounts it with app.use, so it covers that
 * path and everything below it), a `{ path, method }` object (mounted as
 * app.<method>: that exact path only), or a controller class. `.exclude()` is
 * rejected: the rule does not model it.
 *
 * Exempt: `health` and `internal/*` (machine callers behind the internal token).
 *
 * A limiter is one shared instance, so a route that two bindings of the same
 * limiter cover is counted twice per request: only the module that owns a URL
 * prefix binds it, and a sub-module under that prefix binds nothing. Two
 * different limiters on one route (general, then a stricter one) are fine.
 */
import ts from "typescript";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { join, pathArg, routesIn, type Route } from "../helpers/architecture/routes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

export interface LimiterBinding {
  /** The limiter middleware class this binding applies. */
  limiter: string;
  /** A controller class name, or undefined for a path binding. */
  controller?: string;
  path?: string;
  /** Upper-case HTTP method, or "ALL". */
  method: string;
  /** A `{ path, method }` binding matches its path only, not the paths below it. */
  exact?: boolean;
}

/** `consumer.apply(...).forRoutes(...)` chains whose middleware includes a limiter. */
export function limiterBindings(file: string, source: string): LimiterBinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const out: LimiterBinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "forRoutes"
    ) {
      let target = node.expression.expression;
      let limiters: string[] = [];
      while (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression)) {
        if (target.expression.name.text === "exclude") {
          throw new Error(`${file}: .exclude() on a middleware binding; the limiter rule does not model it`);
        }
        if (target.expression.name.text === "apply") {
          limiters = target.arguments.flatMap((a) =>
            ts.isIdentifier(a) && a.text.endsWith("RateLimitMiddleware") ? [a.text] : [],
          );
        }
        target = target.expression.expression;
      }
      for (const limiter of limiters) {
        for (const arg of node.arguments) {
          if (ts.isStringLiteralLike(arg)) {
            out.push({ limiter, path: join(arg.text.replace(/\*$/, "")), method: "ALL" });
          } else if (ts.isIdentifier(arg)) {
            out.push({ limiter, controller: arg.text, method: "ALL" });
          } else if (ts.isObjectLiteralExpression(arg)) {
            let method = "ALL";
            for (const p of arg.properties) {
              if (
                ts.isPropertyAssignment(p) &&
                ts.isIdentifier(p.name) &&
                p.name.text === "method" &&
                ts.isPropertyAccessExpression(p.initializer)
              ) {
                method = p.initializer.name.text;
              }
            }
            const p = pathArg(arg);
            if (p === undefined) throw new Error(`${file}: forRoutes path is not a literal`);
            out.push({ limiter, path: join(p), method, exact: true });
          } else {
            throw new Error(`${file}: forRoutes argument the rule cannot read`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const EXEMPT = (path: string) => path === "health" || path.startsWith("health/") || path.startsWith("internal/");

const covers = (b: LimiterBinding, r: Route) =>
  b.controller !== undefined
    ? b.controller === r.controller
    : (b.method === "ALL" || b.method === r.method) &&
      (r.path === b.path || (!b.exact && r.path.startsWith(`${b.path}/`)));

/** `<METHOD> <path>: <Limiter>` for each route one limiter covers through more than one binding. */
export function doublyCovered(routes: readonly Route[], bindings: readonly LimiterBinding[]): string[] {
  return routes.flatMap((r) => {
    const counts = new Map<string, number>();
    for (const b of bindings) if (covers(b, r)) counts.set(b.limiter, (counts.get(b.limiter) ?? 0) + 1);
    return [...counts].filter(([, n]) => n > 1).map(([limiter]) => `${r.method} ${r.path}: ${limiter}`);
  });
}

export function uncovered(routes: readonly Route[], bindings: readonly LimiterBinding[]): string[] {
  return routes
    .filter((r) => !EXEMPT(r.path) && !bindings.some((b) => covers(b, r)))
    .map((r) => `${r.method} ${r.path}`);
}

describe("limiter coverage rule applies as specified", () => {
  const CONTROLLER = `
@Controller("notices")
export class NoticesController {
  @Get() list() {}
  @Get("tabs") tabs() {}
  @Get("overview") overview() {}
  @Post("events") events() {}
}
@Controller("internal/notices")
export class InternalController {
  @Post("dispatch-pending") dispatch() {}
}
@Controller({ path: "health" })
export class HealthController {
  @Get() health() {}
}`;
  const MODULE = `
export class NoticesModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(FirebaseAuthMiddleware).forRoutes("ad");
    consumer.apply(NoticesRateLimitMiddleware).forRoutes("notices");
    consumer
      .apply(OverviewRateLimitMiddleware)
      .forRoutes({ path: "notices/overview", method: RequestMethod.GET });
  }
}`;

  it("reads routes and limiter bindings", () => {
    expect(routesIn("x.controller.ts", CONTROLLER).map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET notices",
      "GET notices/tabs",
      "GET notices/overview",
      "POST notices/events",
      "POST internal/notices/dispatch-pending",
      "GET health",
    ]);
    expect(limiterBindings("x.module.ts", MODULE)).toEqual([
      { limiter: "NoticesRateLimitMiddleware", path: "notices", method: "ALL" },
      { limiter: "OverviewRateLimitMiddleware", path: "notices/overview", method: "GET", exact: true },
    ]);
  });

  it("passes when every route is covered or exempt, and fails when a forRoutes entry is removed", () => {
    const routes = routesIn("x.controller.ts", CONTROLLER);
    expect(uncovered(routes, limiterBindings("x.module.ts", MODULE))).toEqual([]);
    const without = MODULE.replace('.forRoutes("notices")', '.forRoutes("ad")');
    expect(uncovered(routes, limiterBindings("x.module.ts", without))).toEqual([
      "GET notices",
      "GET notices/tabs",
      "POST notices/events",
    ]);
  });

  it("matches an object binding on its exact path only, as Nest mounts it", () => {
    const routes: Route[] = [
      { controller: "A", method: "POST", path: "ad/events" },
      { controller: "A", method: "POST", path: "ad/events/batch" },
    ];
    expect(uncovered(routes, [{ limiter: "L", path: "ad/events", method: "POST", exact: true }])).toEqual([
      "POST ad/events/batch",
    ]);
  });

  it("flags a route one limiter covers twice, and allows two different limiters", () => {
    const routes = routesIn("x.controller.ts", CONTROLLER);
    expect(doublyCovered(routes, limiterBindings("x.module.ts", MODULE))).toEqual([]);
    const twice = `${MODULE}
export class OverviewModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(NoticesRateLimitMiddleware).forRoutes(NoticesController);
  }
}`;
    expect(doublyCovered(routes, limiterBindings("x.module.ts", twice))).toEqual([
      "GET notices: NoticesRateLimitMiddleware",
      "GET notices/tabs: NoticesRateLimitMiddleware",
      "GET notices/overview: NoticesRateLimitMiddleware",
      "POST notices/events: NoticesRateLimitMiddleware",
    ]);
  });

  it("rejects .exclude(), which it does not model", () => {
    const source = 'class M { configure(c) { c.apply(XRateLimitMiddleware).exclude("x").forRoutes("y"); } }';
    expect(() => limiterBindings("m.module.ts", source)).toThrow(/exclude/);
  });

  it("matches a method-scoped binding by method and a controller binding by class", () => {
    const routes: Route[] = [
      { controller: "A", method: "GET", path: "ad/events" },
      { controller: "B", method: "GET", path: "x/y" },
    ];
    expect(
      uncovered(routes, [
        { limiter: "L", path: "ad/events", method: "POST" },
        { limiter: "L", controller: "B", method: "ALL" },
      ]),
    ).toEqual(["GET ad/events"]);
  });
});

describe("rate limiting", () => {
  it("covers every route that is not exempt", () => {
    const files = sourceFiles();
    const routes = files.flatMap((f) => routesIn(f, readSource(f)));
    expect(routes.length).toBeGreaterThan(20);
    const bindings = files.filter((f) => f.endsWith(".module.ts")).flatMap((f) => limiterBindings(f, readSource(f)));
    expectAllowlisted("rate-limit-coverage", uncovered(routes, bindings));
  });

  it("counts each route once per limiter", () => {
    const files = sourceFiles();
    const routes = files.flatMap((f) => routesIn(f, readSource(f)));
    const bindings = files.filter((f) => f.endsWith(".module.ts")).flatMap((f) => limiterBindings(f, readSource(f)));
    expect(doublyCovered(routes, bindings)).toEqual([]);
  });
});
