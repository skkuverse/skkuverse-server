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
 *
 * In every non-spec src/ file, a top-level function named `assert…` returns
 * `void` or an `asserts …` predicate: it throws or passes, and one that hands
 * back what it read is a `parse…` or `load…`.
 *
 * A repository returns data, never a response (ADR 0010, D2): no public
 * repository method names a type that an exported `.mapper` function returns
 * (document types and brands aside). Response shapes are what mappers make,
 * so a repository that returns one has done the service's job.
 */
import ts from "typescript";
import { NEST_LIFECYCLE, isExported, isNonPublic } from "../helpers/architecture/ast";
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

const PREDICATE = /^(?:is|has|can|needs|should)[A-Z]/;

/** The declared return type with `Promise<…>` removed, or undefined when there is none. */
function returnType(node: ts.SignatureDeclarationBase, sf: ts.SourceFile): string | undefined {
  if (!node.type) return undefined;
  const text = node.type.getText(sf).trim();
  const promise = /^Promise<([\s\S]*)>$/.exec(text);
  return (promise ? promise[1]! : text).trim();
}

const isBooleanType = (t: string) => t === "boolean" || /^\w+ is \S/.test(t) || /^asserts /.test(t);

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
      (isExported(s) || listed.has(s.name.text)),
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
        if (isNonPublic(m) || NEST_LIFECYCLE.has(m.name.text)) continue;
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

const ASSERT_NAME = /^assert[A-Z]/;

/** `<file>: <name>` for each top-level `assert…` function that returns something other than void or `asserts`. */
export function assertVerbViolations(file: string, source: string): string[] {
  if (file.endsWith(".spec.ts")) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const functions = sf.statements.flatMap((s): Array<[string, ts.SignatureDeclarationBase]> => {
    if (ts.isFunctionDeclaration(s) && s.name) return [[s.name.text, s]];
    if (!ts.isVariableStatement(s)) return [];
    return s.declarationList.declarations.flatMap((d): Array<[string, ts.SignatureDeclarationBase]> =>
      ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ? [[d.name.text, d.initializer]]
        : [],
    );
  });
  return functions
    .filter(([name]) => ASSERT_NAME.test(name))
    .filter(([, fn]) => {
      const type = returnType(fn, sf);
      return type === undefined || !(type === "void" || /^asserts /.test(type));
    })
    .map(([name]) => `${file}: ${name}`);
}

/** Names of the types referenced in a type node, type parameters excluded. */
function typeNames(node: ts.TypeNode, typeParams: ReadonlySet<string>): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && !typeParams.has(n.typeName.text)) {
      names.push(n.typeName.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

const typeParamsOf = (node: ts.SignatureDeclarationBase) => new Set((node.typeParameters ?? []).map((p) => p.name.text));

/**
 * The types exported `.mapper` functions return, minus `notData`: the types a
 * repository must not return.
 */
export function mapperOutputTypes(
  sources: ReadonlyArray<{ file: string; source: string }>,
  notData: ReadonlySet<string>,
): Set<string> {
  const names = new Set<string>();
  for (const { file, source } of sources) {
    if (!file.endsWith(".mapper.ts")) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    for (const fn of exportedFunctions(sf)) {
      if (!fn.type) continue;
      for (const name of typeNames(fn.type, typeParamsOf(fn))) if (!notData.has(name)) names.add(name);
    }
  }
  return names;
}

/** Types any layer may hold: every type a `.document` file declares, and every brand. */
export function dataTypeNames(sources: ReadonlyArray<{ file: string; source: string }>): Set<string> {
  const names = new Set<string>();
  for (const { file, source } of sources) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    for (const s of sf.statements) {
      if (!ts.isInterfaceDeclaration(s) && !ts.isTypeAliasDeclaration(s)) continue;
      if (file.endsWith(".document.ts") || (ts.isTypeAliasDeclaration(s) && /^Brand</.test(s.type.getText(sf)))) {
        names.add(s.name.text);
      }
    }
  }
  return names;
}

/** `<file>: <method>` for each public repository method whose return type names a mapper output. */
export function repositoryReturnViolations(file: string, source: string, mapperOutputs: ReadonlySet<string>): string[] {
  if (!file.endsWith(".repository.ts")) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const out: string[] = [];
  for (const cls of sf.statements.filter(ts.isClassDeclaration)) {
    for (const m of cls.members) {
      if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name) || !m.type) continue;
      if (isNonPublic(m)) continue;
      if (typeNames(m.type, typeParamsOf(m)).some((name) => mapperOutputs.has(name))) out.push(`${file}: ${m.name.text}`);
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

describe("assert verb rule applies as specified", () => {
  it("passes an assert that returns void or asserts, and fails one that returns what it read", () => {
    // Arrange
    const source = [
      "export function assertValid(raw: unknown): void {}",
      "function assertShape(raw: unknown): asserts raw is X {}",
      "export const assertAsync = async (raw: unknown): Promise<void> => {};",
      "export function assertValidConfig(raw: unknown): Config { return raw as Config; }",
      "const assertUntyped = (raw: unknown) => raw;",
      "export function parseConfig(raw: unknown): Config { return raw as Config; }",
    ].join("\n");

    // Act & Assert
    expect(assertVerbViolations("src/x/x.config.ts", source)).toEqual(["src/x/x.config.ts: assertValidConfig", "src/x/x.config.ts: assertUntyped"]);
    expect(assertVerbViolations("src/x/x.config.spec.ts", source)).toEqual([]);
  });
});

describe("repository return rule applies as specified", () => {
  const mapper = {
    file: "src/x/x.mapper.ts",
    source: `
export function groupByFloor(spaces: readonly SpaceDoc[]): FloorGroup[] { return []; }
export function withLabel<T extends { campus: Campus }>(item: T): WithLabel<T> { return item as never; }
export function toDoc(raw: RawDoc): XDoc { return raw as never; }
function local(): Hidden { return null as never; }`,
  };
  const outputs = mapperOutputTypes([mapper], dataTypeNames([
    { file: "src/x/x.document.ts", source: "export interface XDoc { a: 1 }" },
    { file: "src/x/x.types.ts", source: "export type SkkuId = Brand<number, 'SkkuId'>;\nexport interface FloorGroup { a: 1 }" },
  ]));

  it("collects what exported mapper functions return, minus documents, brands and type parameters", () => {
    expect([...outputs].sort()).toEqual(["FloorGroup", "WithLabel"]);
  });

  it("rejects a public repository method that returns a mapper output", () => {
    const repo = "src/x/x.repository.ts";
    const source = `
export class XRepository {
  listSpaces(buildNo: string): Promise<Array<Pick<SpaceDoc, "name">>> { return null as never; }
  findDoc(id: number): Promise<XDoc | null> { return null as never; }
  listFloors(buildNo: string): Promise<FloorGroup[]> { return null as never; }
  private grouped(): FloorGroup[] { return []; }
}`;
    expect(repositoryReturnViolations(repo, source, outputs)).toEqual([`${repo}: listFloors`]);
  });
});

describe("repositories", () => {
  it("return no type a mapper produces", () => {
    const files = sourceFiles();
    const read = (f: string) => ({ file: f, source: readSource(f) });
    const outputs = mapperOutputTypes(
      files.filter((f) => f.endsWith(".mapper.ts")).map(read),
      dataTypeNames(files.filter((f) => /\.(?:document|types)\.ts$/.test(f)).map(read)),
    );
    expectAllowlisted(
      "repository-returns",
      files.flatMap((f) => repositoryReturnViolations(f, readSource(f), outputs)),
    );
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

describe("assert functions", () => {
  it("return void or an asserts predicate", () => {
    // Act
    const violations = sourceFiles().flatMap((f) => assertVerbViolations(f, readSource(f)));

    // Assert
    expectAllowlisted("assert-verbs", violations);
  });
});
