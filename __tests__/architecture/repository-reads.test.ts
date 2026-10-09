/**
 * Every Mongo read in a `*.repository.ts` is bounded or cached (ADR 0010, D2).
 * Atlas bills by peak ops/s, so an unbounded hot read is a cost and an outage
 * risk at once.
 *
 * A read is a call to `find`, `findOne`, `aggregate`, `countDocuments`,
 * `estimatedDocumentCount` or `distinct`. It is:
 *
 *   - bounded when its options object literal has a `maxTimeMS` property, or
 *     a `.maxTimeMS(...)` call follows it in the cursor chain;
 *   - cached when it sits inside a `createCachedLoader(...)` call, or inside a
 *     method or function that the loader's `load` callback calls
 *     (`load: () => this.loadAll()`, `load: loadAll`).
 *
 * `maxTimeMS: 0` means no limit, so it does not count.
 *
 * `find`/`findOne` whose first argument is a function are Array methods, not
 * reads. The check is syntactic: an options object passed through a variable
 * does not count, so write the literal at the call.
 */
import ts from "typescript";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

/** Index of the options argument per read method. */
const OPTIONS_ARG: Record<string, number> = {
  find: 1,
  findOne: 1,
  aggregate: 1,
  countDocuments: 1,
  estimatedDocumentCount: 0,
  distinct: 2,
};

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
}

const isZero = (e: ts.Expression) => ts.isNumericLiteral(e) && Number(e.text) === 0;

function hasMaxTimeMs(arg: ts.Expression | undefined): boolean {
  return (
    arg !== undefined &&
    ts.isObjectLiteralExpression(arg) &&
    arg.properties.some(
      (p) =>
        (ts.isShorthandPropertyAssignment(p) && p.name.text === "maxTimeMS") ||
        (ts.isPropertyAssignment(p) &&
          ts.isIdentifier(p.name) &&
          p.name.text === "maxTimeMS" &&
          !isZero(p.initializer)),
    )
  );
}

/** `.find(...).sort(...).maxTimeMS(n)`: walk up the cursor chain. */
function chainedMaxTimeMs(call: ts.CallExpression): boolean {
  let node: ts.Node = call;
  while (ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent.parent)) {
    const bound = node.parent.parent.arguments[0];
    if (node.parent.name.text === "maxTimeMS" && !(bound && isZero(bound))) return true;
    node = node.parent.parent;
  }
  return false;
}

function enclosingFunctionName(node: ts.Node): string | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
      return n.name.text;
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isArrowFunction(n.initializer)) {
      return n.name.text;
    }
    if (ts.isPropertyDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  }
  return undefined;
}

const isLoaderCall = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) && calleeName(n) === "createCachedLoader";

function insideLoader(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (isLoaderCall(n)) return true;
  }
  return false;
}

/**
 * Violations as `<file>: <enclosing method> <read>` (`#2`, `#3` for repeats), so
 * an allowlist entry survives edits that move lines.
 */
export function unboundedReads(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const loaderNames = new Set<string>();
  const reads: ts.CallExpression[] = [];

  const visit = (node: ts.Node): void => {
    if (isLoaderCall(node)) {
      // Only what `load` runs: its callees (`this.loadAll()`), or the function it names.
      const options = node.arguments[0];
      const load =
        options && ts.isObjectLiteralExpression(options)
          ? options.properties.find(
              (p): p is ts.PropertyAssignment =>
                ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "load",
            )?.initializer
          : undefined;
      const callee = (e: ts.Expression): string | undefined =>
        ts.isPropertyAccessExpression(e) ? e.name.text : ts.isIdentifier(e) ? e.text : undefined;
      const collect = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const name = callee(n.expression);
          if (name) loaderNames.add(name);
        }
        ts.forEachChild(n, collect);
      };
      if (load) {
        const named = callee(load);
        if (named) loaderNames.add(named);
        else collect(load);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const first = node.arguments[0];
      const arrayMethod =
        (name === "find" || name === "findOne") &&
        first !== undefined &&
        (ts.isArrowFunction(first) || ts.isFunctionExpression(first));
      if (name in OPTIONS_ARG && !arrayMethod) reads.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return reads
    .filter((call) => {
      const name = calleeName(call)!;
      if (hasMaxTimeMs(call.arguments[OPTIONS_ARG[name]!])) return false;
      if (chainedMaxTimeMs(call)) return false;
      if (insideLoader(call)) return false;
      const fn = enclosingFunctionName(call);
      return !(fn !== undefined && loaderNames.has(fn));
    })
    .map((call) => `${file}: ${enclosingFunctionName(call) ?? "(module)"} ${calleeName(call)}`)
    .map((key, i, all) => {
      const n = all.slice(0, i).filter((k) => k === key).length;
      return n === 0 ? key : `${key} #${n + 1}`;
    });
}

describe("repository read rule applies as specified", () => {
  const FIXTURE = `
import { createCachedLoader } from "../infra/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";

export class FixtureRepository {
  private readonly all = createCachedLoader({
    name: "fixture.all",
    ttlMs: 60_000,
    load: () => this.loadAll(),
  });
  private readonly inline = createCachedLoader({
    name: "fixture.inline",
    ttlMs: 60_000,
    load: () => this.items.find({}).toArray(),
  });

  findOneBounded(id: number) {
    return this.items.findOne({ _id: id }, { maxTimeMS: HOT_READ_MAX_TIME_MS });
  }
  findChained() {
    return this.items.find({}).sort({ _id: 1 }).maxTimeMS(HOT_READ_MAX_TIME_MS).toArray();
  }
  private loadAll() {
    return this.items.find({}).toArray();
  }
  countUnbounded() {
    return this.items.countDocuments({ a: 1 });
  }
  aggregateUnbounded() {
    return this.items.aggregate([{ $match: {} }], { allowDiskUse: true }).toArray();
  }
  distinctBounded() {
    return this.items.distinct("a", {}, { maxTimeMS: 1000 });
  }
  arrayFind(xs: number[]) {
    return xs.find((x) => x > 1);
  }
}`;

  it("flags only the unbounded, uncached reads", () => {
    expect(unboundedReads("src/x/fixture.repository.ts", FIXTURE)).toEqual([
      "src/x/fixture.repository.ts: countUnbounded countDocuments",
      "src/x/fixture.repository.ts: aggregateUnbounded aggregate",
    ]);
  });

  it("counts only what the loader's load runs, and not a zero bound", () => {
    const source = `
export class R {
  private readonly cache = createCachedLoader({ name: "x", ttlMs: config.ttl, load: () => this.loadAll() });
  loadAll() { return this.c.find({}).toArray(); }
  ttl() { return this.c.countDocuments({}); }
  load(id: number) { return this.c.findOne({ _id: id }); }
  zero() { return this.c.find({}, { maxTimeMS: 0 }).toArray(); }
  zeroChained() { return this.c.find({}).maxTimeMS(0).toArray(); }
}`;
    expect(unboundedReads("src/x/r.repository.ts", source)).toEqual([
      "src/x/r.repository.ts: ttl countDocuments",
      "src/x/r.repository.ts: load findOne",
      "src/x/r.repository.ts: zero find",
      "src/x/r.repository.ts: zeroChained find",
    ]);
  });

  it("does not accept an options variable", () => {
    const source = "const opts = { maxTimeMS: 1 };\nexport const f = (c: any) => [c.find({}, opts), c.find({})];";
    expect(unboundedReads("src/x/y.repository.ts", source)).toEqual([
      "src/x/y.repository.ts: f find",
      "src/x/y.repository.ts: f find #2",
    ]);
  });
});

describe("repository reads", () => {
  it("are bounded by maxTimeMS or served through createCachedLoader", () => {
    expectAllowlisted(
      "repository-reads",
      sourceFiles()
        .filter((f) => f.endsWith(".repository.ts"))
        .flatMap((f) => unboundedReads(f, readSource(f))),
    );
  });
});
