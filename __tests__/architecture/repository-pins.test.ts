/**
 * A repository's reads are pinned in its own spec (`.claude/rules/tests.md`,
 * "What to double"): a fake applies the real read's filter, projection and
 * sort, so the repository spec must hold the query object the fake copies, or
 * a dropped filter passes every test while the fake keeps filtering.
 *
 * In a migrated scope, each public method of a `*.repository.ts` class that
 * reads (a `find`, `findOne`, `aggregate`, `countDocuments`,
 * `estimatedDocumentCount` or `distinct` in its body, in a private method it
 * calls, or in the `load` of a `createCachedLoader` whose `.get()` it calls)
 * is called inside a test of the sibling `*.repository.spec.ts` that also
 * asserts on a stub's calls: `.mock.calls`, or `toHaveBeenCalledWith`,
 * `toHaveBeenNthCalledWith` or `toHaveBeenLastCalledWith`. A call counts by
 * the method's name, so a spec's same-named wrapper
 * (`const listBuildings = () => repository.listBuildings()`) counts too.
 *
 * Modules not yet migrated are not checked, so there is no allowlist.
 */
import ts from "typescript";
import { inScope, migratedScopes } from "../helpers/architecture/migrated";
import { parseTestFile } from "../helpers/architecture/tests";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const READS = new Set(["find", "findOne", "aggregate", "countDocuments", "estimatedDocumentCount", "distinct"]);
const LIFECYCLE = new Set(["onModuleInit", "onModuleDestroy", "onApplicationBootstrap", "beforeApplicationShutdown", "onApplicationShutdown"]);
const CALL_ASSERTIONS = new Set(["toHaveBeenCalledWith", "toHaveBeenNthCalledWith", "toHaveBeenLastCalledWith"]);

const isFunctionNode = (n: ts.Node | undefined): boolean => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

/** Whether `node` holds a Mongo read call (an Array `find(fn)` is not one). */
function holdsRead(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && READS.has(n.expression.name.text)) {
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

const isPrivate = (m: ts.ClassElement): boolean =>
  (ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : []).some(
    (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword,
  ) || (m.name !== undefined && ts.isPrivateIdentifier(m.name));

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
      if (!ts.isMethodDeclaration(member) || isPrivate(member) || LIFECYCLE.has(name)) continue;
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

function assertsOnCalls(body: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n)) {
      const isMockCalls = n.name.text === "calls" && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "mock";
      if (isMockCalls || CALL_ASSERTIONS.has(n.name.text)) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

/** The methods no test of the spec both calls and pins with an assertion on a stub's calls. */
export function unpinnedMethods(methods: readonly string[], specFile: string, spec: string | undefined): string[] {
  if (spec === undefined) return [...methods];
  const bodies = parseTestFile(specFile, spec)
    .calls.flatMap((c) => (c.body ? [c.body] : []))
    .filter(assertsOnCalls);
  return methods.filter((name) => !bodies.some((body) => callsNamed(body, name)));
}

/** `<file>: <method>` for each reading method of a migrated repository its spec does not pin. */
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

  it("checks only repositories in migrated scopes", () => {
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

describe("repositories in migrated scopes", () => {
  it("pin each read's query object in their own spec", () => {
    // Act
    const violations = repositoryPinViolations(filesUnder("src"), migratedScopes(), readSource);

    // Assert
    expect(violations).toEqual([]);
  });
});
