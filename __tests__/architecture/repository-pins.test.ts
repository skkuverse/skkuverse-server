/**
 * A repository's reads are pinned in its own spec (`.claude/rules/tests.md`,
 * "What to double"): a fake applies the real read's filter, projection and
 * sort, so the repository spec must hold the query object the fake copies, or
 * a dropped filter passes every test while the fake keeps filtering.
 *
 * In a module scope, each public method of a `*.repository.ts` class that
 * reads (a `find`, `findOne`, `aggregate`, `countDocuments`,
 * `estimatedDocumentCount` or `distinct` in its body, in a private method it
 * calls, or in the `load` of a `createCachedLoader` whose `.get()` it calls)
 * is called inside a test of the sibling `*.repository.spec.ts` that also
 * asserts on the Mongo stub's calls: `expect(<stub>…)` reading `.mock.calls`,
 * or matched with `toHaveBeenCalledWith`, `toHaveBeenNthCalledWith` or
 * `toHaveBeenLastCalledWith`, with at least one argument that is not
 * `expect.anything()` or `expect.any(…)`. The stub is what the spec's
 * `jest.mock` of `infra/db` or `infra/mongo` is built from (its factory's
 * names, and the declarations and assignments they reach), so an assertion
 * on the logger or another mock does not pin a read. A call counts by
 * the method's name, so a spec's same-named wrapper
 * (`const listBuildings = () => repository.listBuildings()`) counts too.
 *
 * Every module scope is checked, and there is no allowlist.
 */
import ts from "typescript";
import { MONGO_READS, NEST_LIFECYCLE, collect, importsOf, isNonPublic, parseSource, resolveSpecifier, skipOuter } from "../helpers/architecture/ast";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { parseTestFile } from "../helpers/architecture/tests";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const MONGO_SEAMS = new Set(["src/infra/db", "src/infra/mongo"]);
const CALL_ASSERTIONS = new Set(["toHaveBeenCalledWith", "toHaveBeenNthCalledWith", "toHaveBeenLastCalledWith"]);

const isFunctionNode = (n: ts.Node | undefined): boolean => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

/** Whether `node` holds a Mongo read call (an Array `find(fn)` is not one). */
function holdsRead(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MONGO_READS.has(n.expression.name.text)) {
      if (!isFunctionNode(n.arguments[0])) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** `this.<name>(…)` and `this.<name>.get()` calls in `node`: the members it reaches. */
function thisMembersCalled(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const target = n.expression.expression;
      if (target.kind === ts.SyntaxKind.ThisKeyword) names.add(n.expression.name.text);
      if (ts.isPropertyAccessExpression(target) && target.expression.kind === ts.SyntaxKind.ThisKeyword && n.expression.name.text === "get") {
        names.add(target.name.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** The public methods of a repository source's classes that read, directly or through a member they call. */
export function readingMethods(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  for (const cls of sf.statements.filter(ts.isClassDeclaration)) {
    const members = new Map<string, ts.ClassElement>();
    for (const m of cls.members) if (m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name))) members.set(m.name.text, m);
    const memo = new Map<string, boolean>();
    const reads = (name: string): boolean => {
      if (memo.has(name)) return memo.get(name)!;
      memo.set(name, false);
      const member = members.get(name);
      const result = member !== undefined && (holdsRead(member) || [...thisMembersCalled(member)].some(reads));
      memo.set(name, result);
      return result;
    };
    for (const [name, member] of members) {
      if (!ts.isMethodDeclaration(member) || isNonPublic(member) || NEST_LIFECYCLE.has(name)) continue;
      if (reads(name)) out.push(name);
    }
  }
  return out;
}

function callsNamed(body: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if ((ts.isIdentifier(callee) && callee.text === name) || (ts.isPropertyAccessExpression(callee) && callee.name.text === name)) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

const identifiersIn = (node: ts.Node): string[] => collect(node, ts.isIdentifier).map((i) => i.text);

/** The left side's root name of an assignment: `findFor[name] = …` → `findFor`. */
function rootName(e: ts.Expression): string | undefined {
  let n = skipOuter(e);
  for (;;) {
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) n = skipOuter(n.expression);
    else if (ts.isCallExpression(n)) n = skipOuter(n.expression);
    else return ts.isIdentifier(n) ? n.text : undefined;
  }
}

/**
 * The names a spec's Mongo stub is made of: the identifiers in the factory of its `jest.mock` of `infra/db` or
 * `infra/mongo` and the names it imports from them, and, transitively, those in the top-level declarations of,
 * assignments to and `mock…(…)` implementations of each of them.
 */
export function mongoStubNames(specFile: string, spec: string): Set<string> {
  const sf = parseSource(specFile, spec);
  const names = new Set<string>();
  for (const call of collect(sf, ts.isCallExpression)) {
    const callee = call.expression;
    const isMock = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "jest" && callee.name.text === "mock";
    const [target, factory] = call.arguments;
    if (isMock && target && ts.isStringLiteralLike(target) && MONGO_SEAMS.has(resolveSpecifier(specFile, target.text)) && factory) {
      for (const name of identifiersIn(factory)) names.add(name);
    }
  }
  for (const i of importsOf(sf)) if (MONGO_SEAMS.has(i.target)) names.add(i.local);
  const sources: Array<[string, ts.Node]> = [];
  for (const call of collect(sf, ts.isCallExpression)) {
    const callee = call.expression;
    const owner = ts.isPropertyAccessExpression(callee) && /^mock/.test(callee.name.text) ? rootName(callee.expression) : undefined;
    if (owner !== undefined) for (const arg of call.arguments) sources.push([owner, arg]);
  }
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) sources.push([d.name.text, d.initializer]);
    if (ts.isFunctionDeclaration(s) && s.name) sources.push([s.name.text, s]);
    for (const b of collect(s, ts.isBinaryExpression)) {
      const left = b.operatorToken.kind === ts.SyntaxKind.EqualsToken ? rootName(b.left) : undefined;
      if (left !== undefined) sources.push([left, b.right]);
    }
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, node] of sources) {
      if (!names.has(name)) continue;
      for (const id of identifiersIn(node)) if (!names.has(id)) grew = names.add(id) !== undefined;
    }
  }
  return names;
}

/** `expect.anything()` / `expect.any(…)`: an argument that pins nothing. */
const isWildcard = (e: ts.Expression): boolean => {
  const n = skipOuter(e);
  return ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "expect" && /^any(?:thing)?$/.test(n.expression.name.text);
};

const isExpectCall = (n: ts.Node): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "expect";

/**
 * Whether `body` asserts on the calls of the Mongo stub: an `expect(<stub>…)` whose subject reads `.mock.calls` or is
 * matched with `toHaveBeenCalledWith` (or Nth/Last), its root one of `stubNames`, with at least one argument that is
 * not `expect.anything()`/`expect.any(…)`.
 */
function assertsOnStubCalls(body: ts.Node, stubNames: ReadonlySet<string>): boolean {
  return collect(body, ts.isCallExpression).some((matcher) => {
    if (!ts.isPropertyAccessExpression(matcher.expression)) return false;
    let receiver: ts.Expression = matcher.expression.expression;
    if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === "not") receiver = receiver.expression;
    if (!isExpectCall(receiver)) return false;
    const subject = receiver.arguments[0];
    if (subject === undefined) return false;
    const readsCalls = collect(subject, ts.isPropertyAccessExpression).some((p) => p.name.text === "calls" && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "mock");
    const pinsCall = CALL_ASSERTIONS.has(matcher.expression.name.text);
    if (!readsCalls && !pinsCall) return false;
    const root = rootName(subject);
    return root !== undefined && stubNames.has(root) && matcher.arguments.some((a) => !isWildcard(a));
  });
}

/** The methods no test of the spec both calls and pins with an assertion on a stub's calls. */
export function unpinnedMethods(methods: readonly string[], specFile: string, spec: string | undefined): string[] {
  if (spec === undefined) return [...methods];
  const stubNames = mongoStubNames(specFile, spec);
  const bodies = parseTestFile(specFile, spec)
    .calls.flatMap((c) => (c.body ? [c.body] : []))
    .filter((body) => assertsOnStubCalls(body, stubNames));
  return methods.filter((name) => !bodies.some((body) => callsNamed(body, name)));
}

/** `<file>: <method>` for each reading method of a repository in `scopes` its spec does not pin. */
export function repositoryPinViolations(files: readonly string[], scopes: readonly string[], read: (f: string) => string): string[] {
  const present = new Set(files);
  return files
    .filter((f) => f.startsWith("src/") && f.endsWith(".repository.ts") && scopes.some((s) => inScope(f, s)))
    .flatMap((file) => {
      const specFile = file.replace(/\.ts$/, ".spec.ts");
      const spec = present.has(specFile) ? read(specFile) : undefined;
      return unpinnedMethods(readingMethods(file, read(file)), specFile, spec).map((m) => `${file}: ${m}`);
    });
}

const REPOSITORY = `
export class XRepository {
  private readonly cache = createCachedLoader({ name: "x", ttlMs: 1, load: () => this.items().find({}).toArray() });
  async onModuleInit(): Promise<void> { await this.items().findOne({}); }
  findById(id: number) { return this.items().findOne({ _id: id }, { maxTimeMS: 1 }); }
  listAll() { return this.cache.get(); }
  countOpen() { return this.count({ open: true }); }
  listIds(xs: number[]) { return xs.find((x) => x > 1); }
  upsert(doc: Doc) { return this.items().updateOne({ _id: doc._id }, { $set: doc }); }
  private count(filter: object) { return this.items().countDocuments(filter, { maxTimeMS: 1 }); }
  private items() { return mongoCollection("db", "items"); }
}`;

describe("repository pin rule applies as specified", () => {
  it("finds the public reads: direct, through a private method, and through a cached loader", () => {
    // Act
    const methods = readingMethods("src/x/x.repository.ts", REPOSITORY);

    // Assert
    expect(methods).toEqual(["findById", "listAll", "countOpen"]);
  });

  it("accepts a test that calls the method, or a same-named wrapper, and asserts on a stub's calls", () => {
    // Arrange
    const spec = `
jest.mock("../infra/db", () => ({ getClient: () => ({ db: () => ({ collection: () => ({ find, findOne, countDocuments }) }) }) }));
const listAll = () => repository.listAll();
it("pins the find", async () => {
  await repository.findById(1);
  expect(findOne.mock.calls[0]).toEqual([{ _id: 1 }, { maxTimeMS: 1 }]);
});
it.each([[1]])("pins the count", async () => {
  await repository.countOpen();
  expect(countDocuments).toHaveBeenCalledWith({ open: true }, { maxTimeMS: 1 });
});
it("pins the loader", async () => {
  await listAll();
  expect(find).toHaveBeenNthCalledWith(1, {});
});`;

    // Act & Assert
    expect(unpinnedMethods(["findById", "listAll", "countOpen"], "src/x/x.repository.spec.ts", spec)).toEqual([]);
  });

  it("refuses a call with no assertion on a stub's calls, an assertion in another test, and a missing spec", () => {
    // Arrange
    const spec = `
it("returns null", async () => {
  await expect(repository.findById(1)).resolves.toBeNull();
});
it("counts", async () => {
  expect(find).toHaveBeenCalledTimes(1);
  await repository.listAll();
});
it("pins something else", async () => {
  expect(findOne.mock.calls).toEqual([]);
});`;

    // Act & Assert
    expect(unpinnedMethods(["findById", "listAll"], "src/x/x.repository.spec.ts", spec)).toEqual(["findById", "listAll"]);
    expect(unpinnedMethods(["findById"], "src/x/x.repository.spec.ts", undefined)).toEqual(["findById"]);
  });

  it("refuses an assertion on another mock, and one whose arguments pin nothing", () => {
    // Arrange
    const spec = `
const collectionFor = (name: string) => ({ find: findFor[name] });
jest.mock("../infra/mongo", () => ({ mongoCollection: (_db: string, name: string) => collectionFor(name) }));
it("logs", async () => {
  await repository.findById(1);
  expect(mockLogger.warn).toHaveBeenCalledWith({ event: "x" }, "m");
});
it("calls", async () => {
  await repository.listAll();
  expect(findFor.items).toHaveBeenCalledWith(expect.anything(), expect.any(Object));
});
it("pins", async () => {
  await repository.countOpen();
  expect(findFor.items.mock.calls[0]).toEqual([{ open: true }, { maxTimeMS: 1 }]);
});`;

    // Act & Assert
    expect(unpinnedMethods(["findById", "listAll", "countOpen"], "src/x/x.repository.spec.ts", spec)).toEqual(["findById", "listAll"]);
  });

  it("checks only repositories in the given scopes", () => {
    // Arrange
    const sources: Record<string, string> = {
      "src/x/x.repository.ts": REPOSITORY,
      "src/z/z.repository.ts": REPOSITORY,
      "src/x/x.repository.spec.ts": "",
    };

    // Act
    const violations = repositoryPinViolations(Object.keys(sources), ["src/x/"], (f) => sources[f]!);

    // Assert
    expect(violations).toEqual(["src/x/x.repository.ts: findById", "src/x/x.repository.ts: listAll", "src/x/x.repository.ts: countOpen"]);
  });
});

describe("repositories in the module scopes", () => {
  it("pin each read's query object in their own spec", () => {
    // Act
    const violations = repositoryPinViolations(filesUnder("src"), moduleScopes(), readSource);

    // Assert
    expect(violations).toEqual([]);
  });
});
