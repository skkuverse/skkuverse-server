/**
 * Every rate-limit class is bound by a route and driven to its refusal by a test (PR 232 F3, ADR 0023 D7). The limits
 * live in PERIMETER_SETTINGS, out of the code, so no test can name them; what the code holds is the class each binding
 * asks RATE_LIMIT_POLICY for. For each value of RATE_LIMIT_CLASSES:
 *
 *   - a limiter middleware in src/http/ asks `handlerFor("<class>")` and a module's configure() applies it, so a
 *     class no route binds, or a binding no module applies, fails here;
 *   - the RATE_LIMIT_POLICY contract drives every class to 429 (`it.each(RATE_LIMIT_CLASSES)` over a `toBe(429)`),
 *     and a spec in every implementation folder runs that contract: the LocalDev classes', and the overlay's when
 *     this checkout carries it (`implementationFolders`).
 *
 * `rate-limit-coverage` checks that each route is bound to a limiter; this checks that each class is.
 */
import ts from "typescript";
import { RATE_LIMIT_CLASSES } from "../../src/perimeter/perimeter.ports";
import { parseSource } from "../helpers/architecture/ast";
import { contractRunnersIn, implementationFolders } from "../helpers/architecture/perimeter-runners";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const CONTRACT = "__tests__/helpers/perimeter/rate-limit-policy.contract.ts";

function calls(root: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

const isMethodCall = (call: ts.CallExpression, method: string): boolean => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === method;

function enclosingClass(node: ts.Node): string | undefined {
  for (let at: ts.Node | undefined = node; at; at = at.parent) if (ts.isClassDeclaration(at)) return at.name?.text;
  return undefined;
}

/** Each middleware class of a source and the classes it asks the policy for, as string literals. */
export function handlerBindings(file: string, source: string): Array<{ middleware: string; limitClass: string }> {
  return calls(parseSource(file, source)).flatMap((call) => {
    const [arg] = call.arguments;
    const middleware = enclosingClass(call);
    if (!isMethodCall(call, "handlerFor") || !arg || !ts.isStringLiteralLike(arg) || middleware === undefined) return [];
    return [{ middleware, limitClass: arg.text }];
  });
}

/** The identifiers a source hands `consumer.apply(...)`. */
export function appliedMiddlewares(file: string, source: string): string[] {
  return calls(parseSource(file, source))
    .filter((call) => isMethodCall(call, "apply"))
    .flatMap((call) => call.arguments.flatMap((arg) => (ts.isIdentifier(arg) ? [arg.text] : [])));
}

/** The classes no applied middleware asks the policy for. */
export function unboundClasses(classes: readonly string[], bindings: ReadonlyArray<{ middleware: string; limitClass: string }>, applied: readonly string[]): string[] {
  return classes.filter((limitClass) => !bindings.some((b) => b.limitClass === limitClass && applied.includes(b.middleware)));
}

/** Whether a contract source has an `it.each(RATE_LIMIT_CLASSES)` case whose body expects a 429. */
export function drivesEveryClassTo429(file: string, source: string): boolean {
  return calls(parseSource(file, source)).some((call) => {
    const each = call.expression;
    if (!ts.isCallExpression(each) || !isMethodCall(each, "each")) return false;
    const [table] = each.arguments;
    const body = call.arguments[1];
    return !!table && ts.isIdentifier(table) && table.text === "RATE_LIMIT_CLASSES" && !!body && /\.toBe\(429\)/.test(body.getText());
  });
}

describe("rate-limit class rule applies as specified", () => {
  const MIDDLEWARE = `
export class NoticesRateLimitMiddleware {
  private readonly limiter = this.policy.handlerFor("notices");
  constructor(private readonly policy: RateLimitPolicy) {}
}
const unrelated = map.handlerFor(name);`;

  it("reads each middleware's literal class and the middlewares a module applies", () => {
    // Act & Assert
    expect(handlerBindings("x.middleware.ts", MIDDLEWARE)).toEqual([{ middleware: "NoticesRateLimitMiddleware", limitClass: "notices" }]);
    expect(appliedMiddlewares("x.module.ts", "class M { configure(c) { c.apply(A, B).forRoutes('x'); c.apply(C).forRoutes('y'); } }")).toEqual(["A", "B", "C"]);
  });

  it("flags a class no middleware asks for, and one whose middleware no module applies", () => {
    // Arrange
    const bindings = [
      { middleware: "GeneralRateLimitMiddleware", limitClass: "general" },
      { middleware: "OverviewRateLimitMiddleware", limitClass: "notices-overview" },
    ];

    // Act & Assert
    expect(unboundClasses(["general", "notices", "notices-overview"], bindings, ["GeneralRateLimitMiddleware"])).toEqual(["notices", "notices-overview"]);
  });

  it.each([
    ["drives every class to 429", 'it.each(RATE_LIMIT_CLASSES)("refuses %s", async (c) => { expect(refusal?.status).toBe(429); });', true],
    ["drives a subset", 'it.each(["general"])("refuses %s", async (c) => { expect(refusal?.status).toBe(429); });', false],
    ["iterates every class without a 429", 'it.each(RATE_LIMIT_CLASSES)("hands out %s", (c) => { expect(first).toBe(second); });', false],
  ])("reads a contract that %s", (_case, source, drives) => {
    // Act & Assert
    expect(drivesEveryClassTo429("x.contract.ts", source)).toBe(drives);
  });
});

describe("rate-limit classes", () => {
  it("are each asked for by a limiter middleware that a module applies", () => {
    // Arrange
    const middlewares = filesUnder("src/http").filter((f) => f.endsWith("-rate-limit.middleware.ts"));
    const bindings = middlewares.flatMap((f) => handlerBindings(f, readSource(f)));
    const applied = filesUnder("src")
      .filter((f) => f.endsWith(".module.ts"))
      .flatMap((f) => appliedMiddlewares(f, readSource(f)));

    // Act & Assert
    expect(bindings.length).toBeGreaterThanOrEqual(RATE_LIMIT_CLASSES.length);
    expect(unboundClasses(RATE_LIMIT_CLASSES, bindings, applied)).toEqual([]);
  });

  it("are each driven to 429 by the contract every implementation set runs", () => {
    // Act & Assert
    expect(drivesEveryClassTo429(CONTRACT, readSource(CONTRACT))).toBe(true);
    expect(implementationFolders().filter((folder) => contractRunnersIn(folder, "describeRateLimitPolicyContract").length === 0)).toEqual([]);
  });
});
