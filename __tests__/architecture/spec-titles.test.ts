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
 * capital or PascalCase with two words; a title that opens in prose ("the
 * reads' query objects", "committed home-layout.json") describes a scenario
 * and is not checked. Nested describes, `describe.each` and route tests in
 * `__tests__/` are out of scope.
 *
 * The allowlist holds the specs of modules not yet migrated; a migrated scope
 * carries no entry (migrated-scopes.test.ts).
 */
import ts from "typescript";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "spec-titles";

const LEADING_NAME = /^@?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/;
const CODE_SHAPED = [/^@/, /\./, /^[a-z][A-Za-z0-9]*[A-Z]/, /^[A-Z][a-z0-9]+[A-Z]/];

interface Exports {
  names: ReadonlySet<string>;
  membersByClass: ReadonlyMap<string, ReadonlySet<string>>;
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

function memberNames(cls: ts.ClassDeclaration): Set<string> {
  return new Set(
    cls.members.flatMap((m) => (m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name)) ? [m.name.text] : [])),
  );
}

/** What a source file exports by name, and the members of each exported class. */
export function exportsOf(file: string, source: string): Exports {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  const membersByClass = new Map<string, Set<string>>();
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) {
      for (const e of s.exportClause.elements) names.add(e.name.text);
    }
    if (!isExported(s)) continue;
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) {
      names.add(s.name.text);
      if (ts.isClassDeclaration(s)) membersByClass.set(s.name.text, memberNames(s));
    } else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) {
      names.add(s.name.text);
    }
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
  if (!CODE_SHAPED.some((shape) => shape.test(leading))) return true;
  const name = leading.replace(/^@/, "");
  if (exported.names.has(name)) return true;
  const [cls, member] = name.split(".");
  return member !== undefined && exported.membersByClass.get(cls!)?.has(member) === true;
}

/** `<spec>: <title>` for each top-level describe that names something its sibling does not export, sorted. */
export function specTitleViolations(files: readonly string[], read: (file: string) => string): string[] {
  const present = new Set(files);
  return files
    .filter((file) => file.startsWith("src/") && file.endsWith(".spec.ts"))
    .filter((spec) => present.has(spec.replace(/\.spec\.ts$/, ".ts")))
    .flatMap((spec) => {
      const exported = exportsOf(spec, read(spec.replace(/\.spec\.ts$/, ".ts")));
      return topLevelDescribeTitles(spec, read(spec))
        .filter((title) => !isTitleOfExport(title, exported))
        .map((title) => `${spec}: ${title}`);
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
  const exported = exportsOf("src/x/x.mapper.ts", source);

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

describe("src/ sibling specs", () => {
  it("open each top-level describe with a name their sibling exports", () => {
    // Act & Assert
    expectAllowlisted(RULE, specTitleViolations(filesUnder("src"), readSource));
  });
});
