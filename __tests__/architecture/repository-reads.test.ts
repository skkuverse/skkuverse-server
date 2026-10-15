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
 * comment (attached: no blank line between), and a type that a repository
 * reads and no `src/` repository writes must carry one: deleting the tag, or
 * detaching it with a blank line, fails instead of switching the check off.
 * A tag a `.document` file holds detached from any type fails too, so a type
 * that a `src/` repository also writes (the push fields of `NoticeDoc`)
 * cannot drop out of the check by detaching its tag. A written type that
 * carries an attached tag stays checked: the writer clause only waives the
 * tag's requirement, never an attached tag. A read that D2 types instead of
 * parsing is a reasoned entry in `exemptions/repository-reads.json`.
 * In a module scope a repository opens a collection only in a private
 * accessor declared to return `Collection<Type>` whose whole body returns
 * `mongoCollection(…)`. A repository read of a collection of that type
 * (`this.<accessor>().find(…)`, or through a local `const` assigned from the
 * accessor) must:
 *
 *   - pass a `projection` of at least one included field in its options
 *     object literal (written there, a top-level `const` it names, or a
 *     `const` a `.query` file exports, which a fake can share), so it loads
 *     only what the flow uses; and
 *   - parse the read's result through a schema imported from a `.schema` file
 *     (`parseEach(docs, schema, …)`, `schema.parse(…)`, `schema.safeParse(…)`):
 *     the read itself or the local it is assigned to, in the member that
 *     reads, or handed to a member that parses its parameter.
 *
 * The rule is strict: no allowlist, and no list may hold an entry under src/
 * (scope-entries.test.ts).
 */
import ts from "typescript";
import {
  MONGO_READ_OPTIONS_ARG,
  MONGO_WRITES,
  collect,
  importsOf,
  isNonPublic,
  parseSource,
  skipOuter,
} from "../helpers/architecture/ast";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { expectExempted } from "../helpers/architecture/exemptions";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const OPTIONS_ARG = MONGO_READ_OPTIONS_ARG;

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
      if (load) {
        const named = callee(load);
        if (named) loaderNames.add(named);
        else {for (const call of collect(load, ts.isCallExpression)) {
          const name = callee(call.expression);
          if (name) loaderNames.add(name);
        }}
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

/** `<file>:<line> CONTRACT tag attached to no type` for each `CONTRACT(<writer>):` comment no declaration carries. */
export function detachedContractTags(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const attachedAt = new Set<number>();
  for (const st of sf.statements) {
    let next = st.getStart(sf);
    for (const range of [...(ts.getLeadingCommentRanges(source, st.getFullStart()) ?? [])].reverse()) {
      if (/\n[ \t]*\n/.test(source.slice(range.end, next))) break;
      if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) attachedAt.add(range.pos);
      next = range.pos;
    }
  }
  const tags = sf.statements.flatMap((st) => ts.getLeadingCommentRanges(source, st.getFullStart()) ?? []);
  return tags
    .filter((range) => /\bCONTRACT\([^)]+\):/.test(source.slice(range.pos, range.end)) && !attachedAt.has(range.pos))
    .map((range) => `${file}:${sf.getLineAndCharacterOfPosition(range.pos).line + 1} CONTRACT tag attached to no type`);
}

/** The document types whose reads must project and parse: every tagged type, and every untagged one only outside src/ writes. */
export function contractReadTypes(repositories: ReadonlyMap<string, string>, tagged: ReadonlySet<string>): Set<string> {
  const untagged = untaggedOutsideWrites(repositories, tagged).map((v) => v.slice(0, v.indexOf(":")));
  return new Set([...tagged, ...untagged]);
}

const PARSE_METHODS = new Set(["parse", "safeParse", "parseAsync", "safeParseAsync"]);

function schemaImports(sf: ts.SourceFile): Set<string> {
  return new Set(importsOf(sf).filter((i) => !i.isType && i.specifier.endsWith(".schema")).map((i) => i.local));
}

/** The node an initializer or argument stands for: the top-level `const` an identifier names, else itself. */
function resolveLocalConst(e: ts.Expression, sf: ts.SourceFile): ts.Expression {
  const n = skipOuter(e);
  if (!ts.isIdentifier(n)) return n;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === n.text && d.initializer) return skipOuter(d.initializer);
  }
  return n;
}

type ModuleReader = (file: string) => string | undefined;

const readIfPresent: ModuleReader = (file) => {
  try {
    return readSource(file);
  } catch {
    return undefined;
  }
};

/** The initializer of the `const` an identifier imports from a `.query` file, when that file exports one. */
function resolveQueryConst(n: ts.Identifier, sf: ts.SourceFile, readModule: ModuleReader): ts.Expression | undefined {
  const imported = importsOf(sf).find((i) => i.local === n.text && i.specifier.endsWith(".query"));
  if (imported === undefined) return undefined;
  const target = `${imported.target}.ts`;
  const source = readModule(target);
  if (source === undefined) return undefined;
  const resolved = resolveLocalConst(ts.factory.createIdentifier(imported.imported ?? n.text), parseSource(target, source));
  return ts.isIdentifier(resolved) ? undefined : resolved;
}

/** An inclusion projection of at least one field: `projection: { a: 1 }`, a top-level `const` holding one, or one a `.query` exports. */
function hasProjection(arg: ts.Expression | undefined, sf: ts.SourceFile, readModule: ModuleReader): boolean {
  if (arg === undefined || !ts.isObjectLiteralExpression(skipOuter(arg))) return false;
  const options = skipOuter(arg) as ts.ObjectLiteralExpression;
  const property = options.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "projection");
  if (property === undefined) return false;
  const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
  const local = value === undefined ? undefined : resolveLocalConst(value, sf);
  const projection = local !== undefined && ts.isIdentifier(local) ? resolveQueryConst(local, sf, readModule) : local;
  if (projection === undefined || !ts.isObjectLiteralExpression(projection)) return false;
  return projection.properties.some((p) => {
    if (!ts.isPropertyAssignment(p)) return false;
    const v = skipOuter(p.initializer);
    return v.kind === ts.SyntaxKind.TrueKeyword || (ts.isNumericLiteral(v) && Number(v.text) !== 0);
  });
}

/** `Collection<T>` accessors of a class: the accessor's name → `T`. */
function collectionAccessors(cls: ts.ClassDeclaration, sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of cls.members) {
    const type = ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name) ? m.type : undefined;
    if (type && ts.isTypeReferenceNode(type) && type.typeName.getText(sf) === "Collection") {
      const arg = type.typeArguments?.[0];
      if (arg && ts.isTypeReferenceNode(arg)) out.set((m.name as ts.Identifier).text, arg.typeName.getText(sf));
    }
  }
  return out;
}

/** The document type a receiver is: `this.<accessor>()`, or a local `const` assigned from one in `member`. */
function receiverType(receiver: ts.Expression, accessors: ReadonlyMap<string, string>, member: ts.Node): string | undefined {
  const r = skipOuter(receiver);
  if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression) && r.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return accessors.get(r.expression.name.text);
  }
  if (!ts.isIdentifier(r)) return undefined;
  const declaration = collect(member, ts.isVariableDeclaration).find((d) => ts.isIdentifier(d.name) && d.name.text === r.text);
  return declaration?.initializer ? receiverType(declaration.initializer, accessors, member) : undefined;
}

interface CollectionCall {
  member: string;
  memberNode: ts.ClassElement;
  call: ts.CallExpression;
  method: string;
  type: string;
}

/** Every driver call on a `Collection<T>` of a repository source's classes, with the member it sits in. */
function collectionCalls(sf: ts.SourceFile): Array<{ cls: ts.ClassDeclaration; calls: CollectionCall[] }> {
  return sf.statements.filter(ts.isClassDeclaration).map((cls) => {
    const accessors = collectionAccessors(cls, sf);
    const calls = cls.members.flatMap((m) => {
      const member = m.name && ts.isIdentifier(m.name) ? m.name.text : undefined;
      if (member === undefined) return [];
      return collect(m, ts.isCallExpression).flatMap((call) => {
        if (!ts.isPropertyAccessExpression(call.expression)) return [];
        const type = receiverType(call.expression.expression, accessors, m);
        return type === undefined ? [] : [{ member, memberNode: m, call, method: call.expression.name.text, type }];
      });
    });
    return { cls, calls };
  });
}

/** The document types a repository source reads, and those it writes. */
export function collectionUse(file: string, source: string): { reads: Set<string>; writes: Set<string> } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const { calls } of collectionCalls(parseSource(file, source))) {
    for (const c of calls) {
      if (c.method in MONGO_READ_OPTIONS_ARG) reads.add(c.type);
      if (MONGO_WRITES.has(c.method)) writes.add(c.type);
    }
  }
  return { reads, writes };
}

/** `<file>: <member> mongoCollection outside a Collection<T> accessor` for each collection a repository opens any other way. */
export function collectionAccessorViolations(file: string, source: string): string[] {
  const sf = parseSource(file, source);
  return collect(sf, ts.isCallExpression)
    .filter((call) => calleeName(call) === "mongoCollection")
    .filter((call) => {
      const ret = call.parent;
      const block = ret?.parent;
      const method = block?.parent;
      const isWholeBody = ts.isReturnStatement(ret) && ts.isBlock(block) && block.statements.length === 1;
      if (!isWholeBody || method === undefined || !ts.isMethodDeclaration(method) || !isNonPublic(method)) return true;
      const type = method.type;
      return !(type && ts.isTypeReferenceNode(type) && type.typeName.getText(sf) === "Collection" && type.typeArguments?.length === 1);
    })
    .map((call) => {
      let n: ts.Node | undefined = call;
      while (n && !(ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isFunctionDeclaration(n))) n = n.parent;
      const where = n && (n as { name?: ts.Node }).name ? (n as { name: ts.Node }).name.getText(sf) : "(module)";
      return `${file}: ${where} mongoCollection outside a Collection<T> accessor`;
    });
}

/**
 * Whether `arg` comes from what `isSource` accepts: it holds it, or it names a local assigned from such an
 * expression, or a callback parameter of a call on one (`docs.map((d) => schema.parse(d))`).
 */
function derivesFrom(arg: ts.Expression, isSource: (n: ts.Node) => boolean, member: ts.Node, depth = 0): boolean {
  if (depth > 8) return false;
  if (isSource(arg) || collect(arg, (x): x is ts.Node => isSource(x)).length > 0) return true;
  const a = skipOuter(arg);
  if (!ts.isIdentifier(a)) return false;
  for (let n: ts.Node | undefined = a.parent; n !== undefined && n !== member.parent; n = n.parent) {
    if (!(ts.isArrowFunction(n) || ts.isFunctionExpression(n))) continue;
    if (!n.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === a.text)) continue;
    const call = n.parent;
    return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && derivesFrom(call.expression.expression, isSource, member, depth + 1);
  }
  return collect(member, ts.isVariableDeclaration).some(
    (d) => ts.isIdentifier(d.name) && d.name.text === a.text && d.initializer !== undefined && derivesFrom(d.initializer, isSource, member, depth + 1),
  );
}

/** The parse calls in a node: `parseEach(x, schema, …)` → x, `schema.parse(x)` → x. */
function parsedArguments(node: ts.Node, schemas: ReadonlySet<string>): ts.Expression[] {
  return collect(node, ts.isCallExpression).flatMap((n) => {
    const callee = n.expression;
    const viaEach = ts.isIdentifier(callee) && callee.text === "parseEach" && n.arguments.some((a) => ts.isIdentifier(a) && schemas.has(a.text));
    const viaMethod =
      ts.isPropertyAccessExpression(callee) && PARSE_METHODS.has(callee.name.text) && ts.isIdentifier(callee.expression) && schemas.has(callee.expression.text);
    return (viaEach || viaMethod) && n.arguments[0] ? [n.arguments[0]] : [];
  });
}

/** `<file>: <member> <read> of <Type>: no projection` / `: no .schema parse`, for each read of a contract type. */
export function contractReadViolations(
  file: string,
  source: string,
  contractTypes: ReadonlySet<string>,
  readModule: ModuleReader = readIfPresent,
): string[] {
  const sf = parseSource(file, source);
  const schemas = schemaImports(sf);
  const out: string[] = [];
  for (const { cls, calls } of collectionCalls(sf)) {
    const members = new Map(cls.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [[m.name.text, m] as const] : [])));
    const memo = new Map<string, boolean>();
    const memberParsesParameter = (name: string): boolean => {
      if (memo.has(name)) return memo.get(name)!;
      memo.set(name, false);
      const member = members.get(name);
      const params = new Set(member && ts.isMethodDeclaration(member) ? member.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])) : []);
      const isParam = (n: ts.Node): boolean => ts.isIdentifier(n) && params.has(n.text) && ts.isParameter(n.parent) === false;
      const result =
        member !== undefined &&
        (parsedArguments(member, schemas).some((a) => derivesFrom(a, isParam, member)) ||
          collect(member, ts.isCallExpression).some((c) => {
            const callee = c.expression;
            const isThisCall = ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword && callee.name.text !== name;
            return isThisCall && c.arguments.some((a) => ts.isIdentifier(skipOuter(a)) && params.has((skipOuter(a) as ts.Identifier).text)) && memberParsesParameter(callee.name.text);
          }));
      memo.set(name, result);
      return result;
    };
    const parsesRead = (c: CollectionCall): boolean => {
      const isRead = (n: ts.Node): boolean => n === c.call;
      if (parsedArguments(c.memberNode, schemas).some((a) => derivesFrom(a, isRead, c.memberNode))) return true;
      return collect(c.memberNode, ts.isCallExpression).some((h) => {
        const callee = h.expression;
        const isThisCall = ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword;
        return isThisCall && h.arguments.some((a) => derivesFrom(a, isRead, c.memberNode)) && memberParsesParameter(callee.name.text);
      });
    };
    for (const c of calls) {
      if (!(c.method in MONGO_READ_OPTIONS_ARG) || !contractTypes.has(c.type)) continue;
      const read = `${file}: ${c.member} ${c.method} of ${c.type}`;
      if (!hasProjection(c.call.arguments[MONGO_READ_OPTIONS_ARG[c.method]!], sf, readModule)) out.push(`${read}: no projection`);
      if (!parsesRead(c)) out.push(`${read}: no .schema parse`);
    }
  }
  return out;
}

/**
 * `<type>: read in src/, written by no src/ repository, and carries no attached CONTRACT(<writer>): tag` for each
 * document type a repository reads that only something outside src/ can have written.
 */
export function untaggedOutsideWrites(
  repositories: ReadonlyMap<string, string>,
  tagged: ReadonlySet<string>,
): string[] {
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const [file, source] of repositories) {
    const use = collectionUse(file, source);
    for (const t of use.reads) reads.add(t);
    for (const t of use.writes) writes.add(t);
  }
  return [...reads]
    .filter((t) => !writes.has(t) && !tagged.has(t))
    .sort()
    .map((t) => `${t}: read in src/, written by no src/ repository, and carries no attached CONTRACT(<writer>): tag`);
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

describe("contract read rule reads every shape of a read (PR 229)", () => {
  const T = new Set(["PlaceDoc"]);
  const repository = (body: string): string => `
import { placeDoc } from "./x.schema";
export class XRepository {
${body}
  private places(): Collection<PlaceDoc> { return mongoCollection<PlaceDoc>("db", "places"); }
}`;

  it.each([
    ["a read through a local variable", "async listLocal() { const c = this.places(); return c.find({}, { maxTimeMS: 1 }).toArray(); }", ["listLocal find of PlaceDoc: no projection", "listLocal find of PlaceDoc: no .schema parse"]],
    ["an empty projection", "async listEmpty() { const docs = await this.places().find({}, { projection: {}, maxTimeMS: 1 }).toArray(); return docs.map((d) => placeDoc.parse(d)); }", ["listEmpty find of PlaceDoc: no projection"]],
    ["an exclusion projection", "async listOut() { return placeDoc.parse(await this.places().findOne({}, { projection: { a: 0 }, maxTimeMS: 1 })); }", ["listOut findOne of PlaceDoc: no projection"]],
    ["a parse of something other than the read", "async listOther() { placeDoc.safeParse({}); return this.places().find({}, { projection: { a: 1 }, maxTimeMS: 1 }).toArray(); }", ["listOther find of PlaceDoc: no .schema parse"]],
  ])("flags %s", (_case, body, problems) => {
    // Act & Assert
    expect(contractReadViolations("src/x/x.repository.ts", repository(body), T)).toEqual(problems.map((p) => `src/x/x.repository.ts: ${p}`));
  });

  it.each([
    ["a parse of the awaited read", "async one() { const doc = await this.places().findOne({}, { projection: { a: 1 }, maxTimeMS: 1 }); return placeDoc.safeParse(doc); }"],
    ["a projection held in a top-level const", "async list() { const docs = await this.places().find({}, { projection: FIELDS, maxTimeMS: 1 }).toArray(); return parseEach(docs, placeDoc, String); }"],
    ["a parse in a member the read is handed to", "async list() { const docs = await this.places().find({}, { projection: { a: 1 }, maxTimeMS: 1 }).toArray(); return this.parseAll(docs); }\n  private parseAll(docs: unknown[]) { return docs.map((d) => placeDoc.parse(d)); }"],
  ])("passes %s", (_case, body) => {
    // Arrange
    const source = `const FIELDS = { a: 1 } as const;\n${repository(body)}`;

    // Act & Assert
    expect(contractReadViolations("src/x/x.repository.ts", source, T)).toEqual([]);
  });

  it("passes a projection a sibling .query file exports, and flags one it cannot find there", () => {
    // Arrange
    const body = "async list() { const docs = await this.places().find({}, { projection: X_FIELDS, maxTimeMS: 1 }).toArray(); return parseEach(docs, placeDoc, String); }";
    const source = `import { X_FIELDS } from "./x.query";\n${repository(body)}`;
    const queries = new Map([["src/x/x.query.ts", "export const X_FIELDS = { a: 1 } as const;"]]);

    // Act
    const found = contractReadViolations("src/x/x.repository.ts", source, T, (f) => queries.get(f));
    const missing = contractReadViolations("src/x/x.repository.ts", source, T, () => undefined);

    // Assert
    expect(found).toEqual([]);
    expect(missing).toEqual(["src/x/x.repository.ts: list find of PlaceDoc: no projection"]);
  });

  it("flags a collection opened anywhere but a private Collection<T> accessor", () => {
    // Arrange
    const source = `
export class XRepository {
  listInline() { return mongoCollection<PlaceDoc>("db", "p").find({}, { maxTimeMS: 1 }).toArray(); }
  private untyped() { return mongoCollection<PlaceDoc>("db", "places"); }
  places(): Collection<PlaceDoc> { return mongoCollection<PlaceDoc>("db", "places"); }
  private typed(): Collection<PlaceDoc> { return mongoCollection<PlaceDoc>("db", "places"); }
}`;

    // Act & Assert
    expect(collectionAccessorViolations("src/x/x.repository.ts", source)).toEqual([
      "src/x/x.repository.ts: listInline mongoCollection outside a Collection<T> accessor",
      "src/x/x.repository.ts: untyped mongoCollection outside a Collection<T> accessor",
      "src/x/x.repository.ts: places mongoCollection outside a Collection<T> accessor",
    ]);
  });

  it("asks a tag of a type src/ reads and never writes, however its tag went missing", () => {
    // Arrange
    const repositories = new Map([
      [
        "src/x/x.repository.ts",
        `export class XRepository {
  list() { return this.places().find({}, { maxTimeMS: 1 }).toArray(); }
  listOurs() { const c = this.ours(); return c.find({}, { maxTimeMS: 1 }).toArray(); }
  save(doc: OurDoc) { return this.ours().insertOne(doc); }
  private places(): Collection<PlaceDoc> { return mongoCollection<PlaceDoc>("db", "places"); }
  private shapes(): Collection<ShapeDoc> { return mongoCollection<ShapeDoc>("db", "shapes"); }
  private ours(): Collection<OurDoc> { return mongoCollection<OurDoc>("db", "ours"); }
  listShapes() { return this.shapes().find({}, { maxTimeMS: 1 }).toArray(); }
}`,
      ],
    ]);
    const detached = contractDocTypes("src/x/x.document.ts", "// CONTRACT(scripts): scripts/a.js writes these.\n\nexport interface PlaceDoc { a: number }");
    const tagged = contractDocTypes("src/x/x.document.ts", "// CONTRACT(scripts): scripts/b.js writes these.\nexport interface ShapeDoc { a: number }");

    // Act
    const violations = untaggedOutsideWrites(repositories, new Set([...detached, ...tagged]));

    // Assert
    expect(violations).toEqual(["PlaceDoc: read in src/, written by no src/ repository, and carries no attached CONTRACT(<writer>): tag"]);
  });
});

describe("contract read rule keeps a written type's tag (PR 249 F9)", () => {
  it("flags a CONTRACT tag that a blank line or a non-type separates from every type", () => {
    // Arrange
    const source = [
      "// CONTRACT(crawler): the crawler writes these.",
      "",
      "export interface Detached { a: number }",
      "",
      "// CONTRACT(crawler): above a value, not a type.",
      "export const X = 1;",
      "",
      "// QUIRK(crawler): an attached block may open with another tag.",
      "// CONTRACT(crawler): still attached.",
      "export interface Attached { a: number }",
    ].join("\n");

    // Act
    const violations = detachedContractTags("src/x/x.document.ts", source);

    // Assert
    expect(violations).toEqual(["src/x/x.document.ts:1 CONTRACT tag attached to no type", "src/x/x.document.ts:5 CONTRACT tag attached to no type"]);
  });

  it("keeps a tagged type that a src/ repository also writes in the parse check", () => {
    // Arrange
    const repositories = new Map([
      [
        "src/x/x.repository.ts",
        `export class XRepository {
  list() { return this.notices().find({}, { maxTimeMS: 1 }).toArray(); }
  stamp(id: string) { return this.notices().updateOne({ id }, { $set: { a: 1 } }); }
  private notices(): Collection<NoticeDoc> { return mongoCollection<NoticeDoc>("db", "notices"); }
}`,
      ],
    ]);

    // Act
    const tagged = contractReadTypes(repositories, new Set(["NoticeDoc"]));
    const untagged = contractReadTypes(repositories, new Set());

    // Assert
    expect([...tagged]).toEqual(["NoticeDoc"]);
    expect([...untagged]).toEqual([]);
  });
});

describe("repository reads of documents written outside src/", () => {
  it("leave no CONTRACT tag in a .document file detached from its type", () => {
    // Arrange
    const documents = sourceFiles().filter((f) => f.endsWith(".document.ts"));

    // Act & Assert
    expect(documents.flatMap((f) => detachedContractTags(f, readSource(f)))).toEqual([]);
  });

  it("are of types that carry their writer's CONTRACT tag", () => {
    // Arrange
    const files = sourceFiles();
    const tagged = new Set(files.filter((f) => f.endsWith(".document.ts")).flatMap((f) => contractDocTypes(f, readSource(f))));
    const repositories = new Map(files.filter((f) => f.endsWith(".repository.ts")).map((f) => [f, readSource(f)]));

    // Act & Assert
    expectAllowlisted("repository-contract-tags", untaggedOutsideWrites(repositories, tagged));
  });

  it("open collections only through a private Collection<T> accessor, in the module scopes", () => {
    // Arrange
    const files = sourceFiles().filter((f) => f.endsWith(".repository.ts") && moduleScopes().some((scope) => inScope(f, scope)));

    // Act & Assert
    expect(files.flatMap((f) => collectionAccessorViolations(f, readSource(f)))).toEqual([]);
  });

  it("project and parse through a .schema", () => {
    // Arrange
    const files = sourceFiles();
    const tagged = new Set(files.filter((f) => f.endsWith(".document.ts")).flatMap((f) => contractDocTypes(f, readSource(f))));
    const repositories = new Map(files.filter((f) => f.endsWith(".repository.ts")).map((f) => [f, readSource(f)]));
    const contractTypes = contractReadTypes(repositories, tagged);

    // Act
    const violations = files.filter((f) => f.endsWith(".repository.ts")).flatMap((f) => contractReadViolations(f, readSource(f), contractTypes));

    // Assert
    expectExempted("repository-reads", violations);
  });
});
