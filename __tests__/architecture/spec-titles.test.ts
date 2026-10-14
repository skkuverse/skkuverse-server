/**
 * A sibling spec names what it tests after the real export (ADR 0011, D1):
 * in `src/**\/<name>.<role>.spec.ts`, a top-level `describe` whose title opens
 * with a code-shaped name opens with one that `<name>.<role>.ts` next to it
 * exports: the identifier itself, `@Name` of an exported decorator, or
 * `Class.member` of an exported class that declares that member. A parity
 * wrapper named after a function that no longer exists (`resolveHomeLayout`
 * for `toHomeLayout`) fails here, so a rename that leaves the spec behind
 * shows.
 *
 * Code-shaped means `@`-prefixed, dotted, lowerCamelCase with an inner
 * capital, PascalCase with two words, an UPPER_CASE constant, or a title
 * that is one identifier (`resolve`, `Gone`); a title that opens in prose
 * ("the reads' query objects", "committed home-layout.json") describes a
 * scenario and is not checked. A name the sibling re-exports through
 * `export *` or destructures counts as exported.
 *
 * A spec may not hide a wrapper behind a prose title either: a top-level
 * function the spec defines, with a code-shaped name the sibling does not
 * export, whose whole body is one call to a sibling export, fails as
 * `wrapper <name>`; call the export where the test uses it. Nested describes, `describe.each` and route tests in
 * `__tests__/` are out of scope.
 *
 * The allowlist holds the specs of modules not yet migrated; a migrated scope
 * carries no entry (migrated-scopes.test.ts).
 */
import ts from "typescript";
import { exportedNamesDeep, exportsOf, parseSource, skipOuter } from "../helpers/architecture/ast";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "spec-titles";

const LEADING_NAME = /^@?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/;
const ONE_IDENTIFIER = /^@?[A-Za-z_$][\w$]*(?:\.[\w$]+)?$/;
const CODE_SHAPED = [/^@/, /\./, /^[a-z][A-Za-z0-9]*[A-Z]/, /^[A-Z][a-z0-9]+[A-Z]/, /^[A-Z][A-Z0-9_]+$/];

interface Exports {
  names: ReadonlySet<string>;
  membersByClass: ReadonlyMap<string, ReadonlySet<string>>;
}

function memberNames(cls: ts.ClassDeclaration): Set<string> {
  return new Set(
    cls.members.flatMap((m) => (m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? [m.name.text] : [])),
  );
}

/**
 * What a source file exports by name (an `export *` of a file among `files` followed through `read`),
 * and the members of each exported class.
 */
export function exportsOfSource(
  file: string,
  source: string,
  read: (file: string) => string = () => "",
  files: ReadonlySet<string> = new Set(),
): Exports {
  const { bindings } = exportsOf(parseSource(file, source));
  const names = exportedNamesDeep(file, (f) => (f === file ? source : read(f)), new Set([...files, file])).names;
  const membersByClass = new Map<string, Set<string>>();
  for (const b of bindings) {
    if (b.kind === "class" && b.declaration && ts.isClassDeclaration(b.declaration)) membersByClass.set(b.exported, memberNames(b.declaration));
  }
  return { names, membersByClass };
}

/** The titles of the top-level `describe("…")` calls whose title is a string literal. */
export function topLevelDescribeTitles(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sf.statements.flatMap((s) => {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) return [];
    const { expression: callee, arguments: [title] } = s.expression;
    if (!ts.isIdentifier(callee) || callee.text !== "describe" || !title) return [];
    return ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title) ? [title.text] : [];
  });
}

/** Whether a title names nothing code-shaped, or opens with a name the sibling exports. */
export function isTitleOfExport(title: string, exported: Exports): boolean {
  const leading = LEADING_NAME.exec(title)?.[0] ?? "";
  if (!ONE_IDENTIFIER.test(title.trim()) && !CODE_SHAPED.some((shape) => shape.test(leading))) return true;
  const name = leading.replace(/^@/, "");
  if (exported.names.has(name)) return true;
  const [cls, member] = name.split(".");
  return member !== undefined && exported.membersByClass.get(cls!)?.has(member) === true;
}

const isCodeShapedName = (name: string): boolean => ONE_IDENTIFIER.test(name) && CODE_SHAPED.some((shape) => shape.test(name));

/** The single expression a function returns: an arrow's body, or a block of one `return`. */
function forwardedExpression(fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration): ts.Expression | undefined {
  const body = fn.body;
  if (body === undefined) return undefined;
  if (!ts.isBlock(body)) return skipOuter(body);
  const [only, ...rest] = body.statements;
  if (only === undefined || rest.length > 0) return undefined;
  if (ts.isReturnStatement(only) && only.expression) return skipOuter(only.expression);
  return ts.isExpressionStatement(only) ? skipOuter(only.expression) : undefined;
}

/**
 * The spec's own top-level functions with a code-shaped name its sibling does not export, whose whole body is one
 * call to a sibling export (`const getChips = (lang) => toMapChips(…, lang)`): a wrapper a title can hide behind.
 */
export function forwardingWrappers(spec: string, source: string, exported: Exports): string[] {
  const sf = parseSource(spec, source);
  const candidates: Array<[string, ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration]> = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) candidates.push([s.name.text, s]);
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      const value = d.initializer ? skipOuter(d.initializer) : undefined;
      if (ts.isIdentifier(d.name) && value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) candidates.push([d.name.text, value]);
    }
  }
  return candidates
    .filter(([name]) => isCodeShapedName(name) && !exported.names.has(name))
    .filter(([, fn]) => {
      const call = forwardedExpression(fn);
      if (call === undefined || !ts.isCallExpression(call)) return false;
      const callee = skipOuter(call.expression);
      const root = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression : callee;
      return ts.isIdentifier(root) && exported.names.has(root.text);
    })
    .map(([name]) => name);
}

/**
 * `<spec>: <title>` for each top-level describe that names something its sibling does not export, and
 * `<spec>: wrapper <name>` for each forwarding wrapper the spec defines, sorted.
 */
export function specTitleViolations(files: readonly string[], read: (file: string) => string): string[] {
  const present = new Set(files);
  return files
    .filter((file) => file.startsWith("src/") && file.endsWith(".spec.ts"))
    .filter((spec) => present.has(spec.replace(/\.spec\.ts$/, ".ts")))
    .flatMap((spec) => {
      const sibling = spec.replace(/\.spec\.ts$/, ".ts");
      const exported = exportsOfSource(sibling, read(sibling), read, present);
      const titles = topLevelDescribeTitles(spec, read(spec))
        .filter((title) => !isTitleOfExport(title, exported))
        .map((title) => `${spec}: ${title}`);
      return [...titles, ...forwardingWrappers(spec, read(spec), exported).map((name) => `${spec}: wrapper ${name}`)];
    })
    .sort();
}

describe("spec title rule applies as specified", () => {
  const source = [
    "export function toHomeLayout(): void {}",
    "export const homeLayoutFile = 1;",
    "export type HomeLayoutRaw = string;",
    "export function CacheControl(): void {}",
    "export class UiHomeService { getHomeLayout(): void {} }",
    "function resolveHomeLayout(): void {}",
    "const helper = 2;",
    "export { helper as renamedHelper };",
  ].join("\n");
  const exported = exportsOfSource("src/x/x.mapper.ts", source);

  it.each([
    "toHomeLayout",
    "toHomeLayout with a feed section",
    "homeLayoutFile",
    "HomeLayoutRaw",
    "renamedHelper",
    "@CacheControl",
    "UiHomeService",
    "UiHomeService.getHomeLayout",
    "UiHomeService.getHomeLayout, phase 1",
    "committed home-layout.json",
    "the reads' query objects",
    "miniapp_feed section",
    "building tiers",
  ])("passes %p", (title) => {
    // Act & Assert
    expect(isTitleOfExport(title, exported)).toBe(true);
  });

  it.each([
    "resolveHomeLayout",
    "assertValidHomeLayout (via loadHomeLayout)",
    "getHomeLayout",
    "UiHomeService.resolve",
    "UiCampusService.getCampusSheet",
    "@Lang",
    "resolve",
    "Gone",
    "OLD_LIMIT",
  ])("fails %p, which the sibling does not export", (title) => {
    // Act & Assert
    expect(isTitleOfExport(title, exported)).toBe(false);
  });

  it("reads only top-level describes with a literal title", () => {
    // Arrange
    const spec = [
      'describe("toHomeLayout", () => { describe("innerName", () => {}); });',
      "describe(`homeLayoutFile`, () => {});",
      'describe.each([1])("eachName %s", () => {});',
      "describe(TITLE, () => {});",
      'it("loose", () => {});',
    ].join("\n");

    // Act
    const titles = topLevelDescribeTitles("src/x/x.mapper.spec.ts", spec);

    // Assert
    expect(titles).toEqual(["toHomeLayout", "homeLayoutFile"]);
  });

  it("checks a src/ spec against its sibling only, and skips a spec without one", () => {
    // Arrange
    const sources: Record<string, string> = {
      "src/x/x.mapper.ts": "export function toX(): void {}",
      "src/x/x.mapper.spec.ts": 'describe("toX", () => {});\ndescribe("toY", () => {});',
      "src/x/y/x-y.rules.ts": "export function isY(): boolean { return true; }",
      "src/x/y/x-y.rules.spec.ts": 'describe("toX", () => {});',
      "src/x/orphan.spec.ts": 'describe("toZ", () => {});',
      "__tests__/x/x.mapper.spec.ts": 'describe("toY", () => {});',
    };

    // Act
    const violations = specTitleViolations(Object.keys(sources), (file) => sources[file] ?? "");

    // Assert
    expect(violations).toEqual(["src/x/x.mapper.spec.ts: toY", "src/x/y/x-y.rules.spec.ts: toX"]);
  });
});

describe("spec title rule reads exports and wrappers", () => {
  it("passes a name the sibling exports through export * or destructuring", () => {
    // Arrange
    const sources: Record<string, string> = {
      "src/x/x.mapper.ts": 'export * from "./y";\nexport const { aB } = obj;',
      "src/x/y.ts": "export function toY(): void {}",
    };
    const read = (f: string): string => sources[f] ?? "";

    // Act
    const exported = exportsOfSource("src/x/x.mapper.ts", read("src/x/x.mapper.ts"), read, new Set(Object.keys(sources)));

    // Assert
    expect(isTitleOfExport("toY", exported)).toBe(true);
    expect(isTitleOfExport("aB", exported)).toBe(true);
  });

  it("flags a spec-defined wrapper that only forwards to an export, whatever its describe is titled", () => {
    // Arrange
    const sources: Record<string, string> = {
      "src/x/x.mapper.ts": "export function toMapChips(): void {}\nexport const LIMIT = 1;",
      "src/x/x.mapper.spec.ts": [
        "const getChips = (lang: string) => toMapChips(SPECS, lang);",
        "function chipsOf(lang: string) { return toMapChips(SPECS, lang); }",
        "const arrange = () => toMapChips(SPECS);",
        "const buildChips = (lang: string) => { const specs = SPECS; return toMapChips(specs, lang); };",
        "const fixtureChips = (lang: string) => other(lang);",
        "const toMapChipsCopy = () => [toMapChips()];",
        'describe("the chips /map/config serves", () => { it("x", () => { expect(getChips("ko")).toBeDefined(); }); });',
      ].join("\n"),
    };

    // Act
    const violations = specTitleViolations(Object.keys(sources), (f) => sources[f] ?? "");

    // Assert
    expect(violations).toEqual(["src/x/x.mapper.spec.ts: wrapper chipsOf", "src/x/x.mapper.spec.ts: wrapper getChips"]);
  });
});

describe("src/ sibling specs", () => {
  it("open each top-level describe with a name their sibling exports", () => {
    // Act & Assert
    expectAllowlisted(RULE, specTitleViolations(filesUnder("src"), readSource));
  });
});
