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
 *
 * Data written outside src/ is parsed where it is read (ADR 0010, D2;
 * `.claude/rules/architecture.md`). A document type is written outside src/
 * when its declaration in a `.document` file carries a `CONTRACT(<writer>):`
 * comment (attached: no blank line between). A repository read of a
 * collection of that type (`this.<accessor>().find(…)`, the accessor declared
 * to return `Collection<Type>`) must:
 *
 *   - pass a `projection` in its options object literal, so it loads only
 *     what the flow uses; and
 *   - parse the result through a schema imported from a `.schema` file
 *     (`parseEach(docs, schema, …)`, `schema.parse(…)`, `schema.safeParse(…)`)
 *     in the member that reads, or in a member of the class it calls.
 *
 * In a migrated scope the allowlist is empty (migrated-scopes.test.ts).
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

/** The document types a `.document` source declares with an attached `CONTRACT(…)` comment. */
export function contractDocTypes(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const attached = (node: ts.Node): string[] => {
    const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
    const out: string[] = [];
    let next = node.getStart(sf);
    for (const range of [...ranges].reverse()) {
      if (/\n[ \t]*\n/.test(source.slice(range.end, next))) break;
      out.push(source.slice(range.pos, range.end));
      next = range.pos;
    }
    return out;
  };
  return sf.statements
    .filter((st): st is ts.InterfaceDeclaration | ts.TypeAliasDeclaration => ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st))
    .filter((st) => attached(st).some((c) => /\bCONTRACT\([^)]+\):/.test(c)))
    .map((st) => st.name.text);
}

const PARSE_METHODS = new Set(["parse", "safeParse", "parseAsync", "safeParseAsync"]);

function schemaImports(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.endsWith(".schema")) continue;
    const bindings = st.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) if (!e.isTypeOnly) names.add(e.name.text);
  }
  return names;
}

function parsesWith(node: ts.Node, schemas: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const viaEach = ts.isIdentifier(callee) && callee.text === "parseEach" && n.arguments.some((a) => ts.isIdentifier(a) && schemas.has(a.text));
      const viaMethod =
        ts.isPropertyAccessExpression(callee) && PARSE_METHODS.has(callee.name.text) && ts.isIdentifier(callee.expression) && schemas.has(callee.expression.text);
      if (viaEach || viaMethod) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function hasProjection(arg: ts.Expression | undefined): boolean {
  return (
    arg !== undefined &&
    ts.isObjectLiteralExpression(arg) &&
    arg.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === "projection")
  );
}

/** `this.<accessor>()` → the accessor's name. */
function accessorOf(receiver: ts.Expression): string | undefined {
  if (!ts.isCallExpression(receiver) || !ts.isPropertyAccessExpression(receiver.expression)) return undefined;
  return receiver.expression.expression.kind === ts.SyntaxKind.ThisKeyword ? receiver.expression.name.text : undefined;
}

/** `<file>: <member> <read> of <Type>: no projection` / `: no .schema parse`, for each read of a contract type. */
export function contractReadViolations(file: string, source: string, contractTypes: ReadonlySet<string>): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const schemas = schemaImports(sf);
  const out: string[] = [];
  for (const cls of sf.statements.filter(ts.isClassDeclaration)) {
    const members = new Map(cls.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [[m.name.text, m] as const] : [])));
    const collectionOf = new Map<string, string>();
    for (const [name, m] of members) {
      const type = ts.isMethodDeclaration(m) ? m.type : undefined;
      if (type && ts.isTypeReferenceNode(type) && type.typeName.getText(sf) === "Collection") {
        const arg = type.typeArguments?.[0];
        if (arg && ts.isTypeReferenceNode(arg)) collectionOf.set(name, arg.typeName.getText(sf));
      }
    }
    const memo = new Map<string, boolean>();
    const memberParses = (name: string): boolean => {
      if (memo.has(name)) return memo.get(name)!;
      memo.set(name, false);
      const member = members.get(name);
      let calls: string[] = [];
      if (member) {
        const visit = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
            calls.push(n.expression.name.text);
          }
          ts.forEachChild(n, visit);
        };
        visit(member);
      }
      calls = calls.filter((c) => c !== name);
      const result = member !== undefined && (parsesWith(member, schemas) || calls.some(memberParses));
      memo.set(name, result);
      return result;
    };
    for (const [name, member] of members) {
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text in OPTIONS_ARG) {
          const type = collectionOf.get(accessorOf(n.expression.expression) ?? "");
          if (type !== undefined && contractTypes.has(type)) {
            const read = `${file}: ${name} ${n.expression.name.text} of ${type}`;
            if (!hasProjection(n.arguments[OPTIONS_ARG[n.expression.name.text]!])) out.push(`${read}: no projection`);
            if (!memberParses(name)) out.push(`${read}: no .schema parse`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(member);
    }
  }
  return out;
}

describe("contract read rule applies as specified", () => {
  it("finds the document types with an attached CONTRACT comment", () => {
    // Arrange
    const source = [
      'import type { X } from "./x";',
      "",
      "// CONTRACT(scripts): a file-level note, apart from the next declaration.",
      "",
      "export interface Plain { a: number }",
      "",
      "/** CONTRACT(scripts): scripts/a.js writes these. */",
      "export interface Written { a: number }",
      "",
      "// CONTRACT(skkuverse-crawler): the crawler writes these. Why a collection",
      "// of its own: docs/x.md.",
      "export type AlsoWritten = { a: number };",
      "",
      "/** WHY: not a contract. */",
      "export interface Ours { a: number }",
    ].join("\n");

    // Act & Assert
    expect(contractDocTypes("src/x/x.document.ts", source)).toEqual(["Written", "AlsoWritten"]);
  });

  const REPOSITORY = `
import { placeDoc } from "./x.schema";
import { parseEach } from "../shared/zod-list.util";
export class XRepository {
  private readonly cache = createCachedLoader({
    name: "x", ttlMs: 1,
    load: async () => parseEach(await this.places().find({}, { projection: { a: 1 }, maxTimeMS: 1 }).toArray(), placeDoc, String).valid,
  });
  listParsed() { return this.cache.get(); }
  async listViaHelper(id: string) {
    const docs = await this.places().find({ id }, { projection: { a: 1 }, maxTimeMS: 1 }).toArray();
    return this.parsePlaces(docs);
  }
  async findUnprojected(id: string) {
    const doc = await this.places().findOne({ id }, { maxTimeMS: 1 });
    return placeDoc.parse(doc);
  }
  listUnparsed(id: string) { return this.places().find({ id }, { projection: { a: 1 }, maxTimeMS: 1 }).toArray(); }
  listOurs() { return this.ours().find({}, { maxTimeMS: 1 }).toArray(); }
  private parsePlaces(docs: unknown[]) { return docs.map((d) => placeDoc.safeParse(d)); }
  private places(): Collection<PlaceDoc> { return mongoCollection("db", "places"); }
  private ours(): Collection<OurDoc> { return mongoCollection("db", "ours"); }
}`;

  it("passes a projected read parsed in its member or a member it calls, and leaves other types alone", () => {
    // Act
    const violations = contractReadViolations("src/x/x.repository.ts", REPOSITORY, new Set(["PlaceDoc"]));

    // Assert
    expect(violations).toEqual([
      "src/x/x.repository.ts: findUnprojected findOne of PlaceDoc: no projection",
      "src/x/x.repository.ts: listUnparsed find of PlaceDoc: no .schema parse",
    ]);
  });

  it("does not count a parse through a schema that no .schema file exports", () => {
    // Arrange
    const source = REPOSITORY.replace('import { placeDoc } from "./x.schema";', 'import { placeDoc } from "./x.wire";');

    // Act
    const violations = contractReadViolations("src/x/x.repository.ts", source, new Set(["PlaceDoc"]));

    // Assert
    expect(violations.filter((v) => v.endsWith("no .schema parse"))).toHaveLength(4);
  });
});

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

describe("repository reads of documents written outside src/", () => {
  it("project and parse through a .schema", () => {
    // Arrange
    const files = sourceFiles();
    const contractTypes = new Set(files.filter((f) => f.endsWith(".document.ts")).flatMap((f) => contractDocTypes(f, readSource(f))));

    // Act
    const violations = files.filter((f) => f.endsWith(".repository.ts")).flatMap((f) => contractReadViolations(f, readSource(f), contractTypes));

    // Assert
    expectAllowlisted("repository-contract-reads", violations);
  });
});
