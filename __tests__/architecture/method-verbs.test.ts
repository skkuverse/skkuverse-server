/**
 * Method verbs carry a return contract (ADR 0010, D4), checked against the
 * declared return type:
 *
 *   - a public method of a `*.repository.ts` class starts with a verb from
 *     REPOSITORY_VERBS and returns what that verb promises: `find*` one or
 *     `null`, `list*` an array, Set or Map, `count*` a number, `exists*` a
 *     boolean. There is no `get*`.
 *   - a public method or exported function of a `*.client.ts` starts with
 *     `fetch`, `post` or `send`.
 *   - an exported function of a `.rules` or `.mapper` file starts with `is`,
 *     `has`, `can`, `needs` or `should` exactly when it returns a boolean.
 *
 * A repository or client method without a return type is a violation: the
 * contract is read from the annotation, not inferred.
 */
import ts from "typescript";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

type Contract = (returnType: string) => boolean;

const anything: Contract = () => true;
const nullable: Contract = (t) => /\bnull\b|\bundefined\b/.test(t);
const collection: Contract = (t) =>
  /\[\]$/.test(t) || /^(?:readonly\s+)?\S.*\[\]$/.test(t) || /^(?:Readonly)?(?:Array|Set|Map)</.test(t);
const number: Contract = (t) => t === "number";
const boolean: Contract = (t) => t === "boolean";

const REPOSITORY_VERBS: Readonly<Record<string, Contract>> = {
  find: nullable,
  list: collection,
  search: anything,
  count: number,
  exists: boolean,
  insert: anything,
  upsert: anything,
  update: anything,
  set: anything,
  delete: anything,
  record: anything,
  claim: anything,
  ensure: anything,
  clear: anything,
};

const CLIENT_VERBS: Readonly<Record<string, Contract>> = { fetch: anything, post: anything, send: anything };

const LIFECYCLE = new Set([
  "onModuleInit",
  "onModuleDestroy",
  "onApplicationBootstrap",
  "beforeApplicationShutdown",
  "onApplicationShutdown",
]);

const PREDICATE = /^(?:is|has|can|needs|should)[A-Z]/;

/** The declared return type with `Promise<…>` removed, or undefined when there is none. */
function returnType(node: ts.SignatureDeclarationBase, sf: ts.SourceFile): string | undefined {
  if (!node.type) return undefined;
  const text = node.type.getText(sf).trim();
  const promise = /^Promise<([\s\S]*)>$/.exec(text);
  return (promise ? promise[1]! : text).trim();
}

const isBooleanType = (t: string) => t === "boolean" || /^\w+ is \S/.test(t) || /^asserts /.test(t);

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

function roleOf(file: string): string | undefined {
  return /\.(repository|client|rules|mapper)\.ts$/.exec(file)?.[1];
}

/** Functions a file exports, by declaration or by an `export { … }` list. */
function exportedFunctions(sf: ts.SourceFile): ts.FunctionDeclaration[] {
  const listed = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s) && !s.isTypeOnly && s.exportClause && ts.isNamedExports(s.exportClause)) {
      for (const e of s.exportClause.elements) if (!e.isTypeOnly) listed.add((e.propertyName ?? e.name).text);
    }
  }
  return sf.statements.filter(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) &&
      !!s.name &&
      (hasModifier(s, ts.SyntaxKind.ExportKeyword) || listed.has(s.name.text)),
  );
}

function verbViolation(name: string, type: string | undefined, verbs: Readonly<Record<string, Contract>>): boolean {
  const verb = /^[a-z]+/.exec(name)?.[0] ?? "";
  const contract = verbs[verb];
  return !contract || type === undefined || !contract(type);
}

/** `<file>: <name>` for each method or function whose name and declared return type disagree. */
export function methodVerbViolations(file: string, source: string): string[] {
  const role = roleOf(file);
  if (!role || file.endsWith(".spec.ts")) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const out: string[] = [];

  if (role === "repository" || role === "client") {
    const verbs = role === "repository" ? REPOSITORY_VERBS : CLIENT_VERBS;
    for (const cls of sf.statements.filter(ts.isClassDeclaration)) {
      for (const m of cls.members) {
        if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name)) continue;
        if (hasModifier(m, ts.SyntaxKind.PrivateKeyword) || hasModifier(m, ts.SyntaxKind.ProtectedKeyword)) continue;
        if (LIFECYCLE.has(m.name.text)) continue;
        if (verbViolation(m.name.text, returnType(m, sf), verbs)) out.push(`${file}: ${m.name.text}`);
      }
    }
    if (role === "client") {
      for (const fn of exportedFunctions(sf)) {
        if (verbViolation(fn.name!.text, returnType(fn, sf), CLIENT_VERBS)) out.push(`${file}: ${fn.name!.text}`);
      }
    }
    return out;
  }

  for (const fn of exportedFunctions(sf)) {
    const name = fn.name!.text;
    const type = returnType(fn, sf);
    const predicateName = PREDICATE.test(name);
    if (predicateName ? type === undefined || !isBooleanType(type) : type !== undefined && isBooleanType(type)) {
      out.push(`${file}: ${name}`);
    }
  }
  return out;
}

describe("method verb rule applies as specified", () => {
  const repo = "src/x/x.repository.ts";

  it("accepts each repository verb with the return type it promises", () => {
    const source = `
export class XRepository {
  async onModuleInit(): Promise<void> {}
  findById(id: number): Promise<Doc | null> { return null as never; }
  async listAll(): Promise<Doc[]> { return []; }
  listIds(): Promise<Set<number>> { return null as never; }
  listUpdatedAt(): Map<number, string> { return null as never; }
  searchByKeyword(q: string): Promise<Ranked<Doc>> { return null as never; }
  countOpen(): Promise<number> { return 0 as never; }
  upsertMany(docs: Doc[]): Promise<BulkWriteResult> { return null as never; }
  deleteBefore(at: Date): Promise<number> { return 0 as never; }
  ensureIndexes(): Promise<void> { return null as never; }
  clearCache(): void {}
  private raw() { return 1; }
}`;
    expect(methodVerbViolations(repo, source)).toEqual([]);
  });

  it("rejects get*, an unknown verb, a missing return type and a broken contract", () => {
    const source = `
export class XRepository {
  getById(id: number): Promise<Doc | null> { return null as never; }
  loadAll(): Promise<Doc[]> { return []; }
  async findAll() { return []; }
  findById(id: number): Promise<Doc> { return null as never; }
  listAll(): Promise<Doc> { return null as never; }
}`;
    expect(methodVerbViolations(repo, source)).toEqual([
      `${repo}: getById`,
      `${repo}: loadAll`,
      `${repo}: findAll`,
      `${repo}: findById`,
      `${repo}: listAll`,
    ]);
  });

  it("holds clients to fetch, post and send", () => {
    const client = "src/x/x.client.ts";
    const source = `
export class XClient {
  async fetchList(): Promise<Item[]> { return []; }
  async getList(): Promise<Item[]> { return []; }
}
export function postEvent(e: E): Promise<R> { return null as never; }
function helper(): number { return 1; }`;
    expect(methodVerbViolations(client, source)).toEqual([`${client}: getList`]);
  });

  it("ties a predicate name to a boolean return in rules and mappers", () => {
    const rules = "src/x/x.rules.ts";
    const source = `
export function needsSync(a: number): boolean { return a > 0; }
function isGeometry(v: unknown): v is Geometry { return true; }
function isOpen(): number { return 1; }
function openNow(): boolean { return true; }
function toKey(x: string): string { return x; }
function withLabel(x: string) { return x; }
function internal(): boolean { return true; }
export { isGeometry, isOpen, openNow, toKey, withLabel };`;
    expect(methodVerbViolations(rules, source)).toEqual([`${rules}: isOpen`, `${rules}: openNow`]);
  });
});

describe("method verbs", () => {
  it("match their declared return types (find → T | null, list → collection, no get; fetch/post/send in clients; is/has/can/needs/should ⇔ boolean)", () => {
    const files = sourceFiles();
    expectAllowlisted(
      "method-verbs",
      files.flatMap((f) => methodVerbViolations(f, readSource(f))),
    );
  });
});
