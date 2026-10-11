/**
 * File and class names under src/ (ADR 0010, D4):
 *
 *   - suffix: `<name>.<role>.ts` with a role from the closed vocabulary below.
 *     `.spec` and `.generated` wrap a valid name (`foo.service.spec.ts`).
 *     `.util` is allowed only in src/shared/. Files in src/infra/ are named by
 *     the resource they wrap (`db.ts`, `logger.ts`) and need no role.
 *   - kebab-case: every dot-separated part of the name.
 *   - class name: an exported class in a file whose role is a class role is
 *     PascalCase(name) + PascalCase(role): `notice-dispatch.repository.ts`
 *     exports `NoticeDispatchRepository`. A `.error.ts` file may export several
 *     classes; each starts with PascalCase(name) and ends with `Error`.
 *   - exported types: only a `.types`, `.document`, `.schema` or `.wire` file
 *     exports an interface or type alias; a type used inside one file stays
 *     there, unexported. src/infra/ files, named by resource, are not checked.
 *   - main export: a class-role, `.decorator` or `.bootstrap` file exports
 *     something named after the file, so either can be found from the other:
 *     a class `NoStoreMiddleware`, a function `noStoreMiddleware`, a decorator
 *     `CacheControl`. A `.bootstrap` file builds the app or applies the
 *     app-wide pipeline, so its function opens with the verb:
 *     `http-app.bootstrap.ts` exports `bootstrapHttpApp`.
 *   - type files: a `.types` or `.document` file holds no runtime code. A
 *     `.wire` file is not one: it holds zod schemas and their `z.input` types.
 *   - brands: a brand type (an alias of `Brand<…>` in a `.types` file) gets
 *     its brand only from its one minter, a top-level function in the `.rules`
 *     file of the folder that declares it: `is<Brand>`, a type predicate, or
 *     `to<Brand>`, the only place `as <Brand>` appears. `brand-casts` reports a
 *     cast, a type predicate, `z.custom<Brand>` or zod's `.brand<` anywhere
 *     else in a non-spec source; specs may cast. `brand-minters` reports a
 *     brand whose folder's `.rules` holds no minter, or more than one. Both
 *     read syntax only, so a cast through an alias (`type X = SkkuId`) or a
 *     generic `as T` is not seen.
 */
import ts from "typescript";
import { numberedKeys } from "../helpers/architecture/comments";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { CLASS_ROLES, EXEMPT, ROLES, parse } from "../helpers/architecture/names";
import { readSource, filesUnder } from "../helpers/architecture/tree";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const inInfra = (dir: string) => dir === "src/infra" || dir.startsWith("src/infra/");
const inShared = (dir: string) => dir === "src/shared" || dir.startsWith("src/shared/");

export function suffixViolation(file: string): boolean {
  if (EXEMPT.has(file)) return false;
  const { parts, dir } = parse(file);
  if (inInfra(dir) && parts.length === 1) return false;
  if (parts.length !== 2) return true;
  const role = parts[1]!;
  if (!ROLES.has(role)) return true;
  return role === "util" && !inShared(dir);
}

export function kebabViolation(file: string): boolean {
  if (EXEMPT.has(file)) return false;
  return !parse(file).parts.every((p) => KEBAB.test(p));
}

const pascal = (kebab: string) =>
  kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

function exportedClasses(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.ES2022, false);
  return sf.statements.flatMap((s) =>
    ts.isClassDeclaration(s) &&
    s.name &&
    s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ? [s.name.text]
      : [],
  );
}

/** `<file>: <class>` for each exported class whose name does not match its file. */
export function classNameViolations(file: string, source: string): string[] {
  if (EXEMPT.has(file) || file.endsWith(".spec.ts")) return [];
  const { parts } = parse(file);
  if (parts.length !== 2 || !CLASS_ROLES.has(parts[1]!)) return [];
  const [base, role] = parts as [string, string];
  const ok =
    role === "error"
      ? (name: string) => name.startsWith(pascal(base)) && name.endsWith("Error")
      : (name: string) => name === pascal(base) + pascal(role);
  return exportedClasses(source)
    .filter((name) => !ok(name))
    .map((name) => `${file}: ${name}`);
}

/** Exported interfaces and type aliases, and the names in a type-only `export { … }`. */
function exportedTypes(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.ES2022, false);
  return sf.statements.flatMap((s) => {
    if (
      (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
      s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return [s.name.text];
    }
    if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) {
      return s.exportClause.elements.filter((e) => s.isTypeOnly || e.isTypeOnly).map((e) => e.name.text);
    }
    return [];
  });
}

const TYPE_ROLES = new Set(["types", "document", "schema", "wire"]);

/** `<file>: <type>` for each type a role file other than `.types`, `.document`, `.schema` or `.wire` exports. */
export function exportedTypeViolations(file: string, source: string): string[] {
  if (EXEMPT.has(file) || file.endsWith(".spec.ts")) return [];
  const { parts } = parse(file);
  if (parts.length !== 2 || !ROLES.has(parts[1]!) || TYPE_ROLES.has(parts[1]!)) return [];
  return exportedTypes(source).map((name) => `${file}: ${name}`);
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Value names a file exports: classes, functions, variables, and the non-type names of `export { … }`. */
function exportedValues(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.ES2022, false);
  return sf.statements.flatMap((s) => {
    if ((ts.isClassDeclaration(s) || ts.isFunctionDeclaration(s)) && s.name && isExported(s)) return [s.name.text];
    if (ts.isVariableStatement(s) && isExported(s)) {
      return s.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
    }
    if (ts.isExportDeclaration(s) && !s.isTypeOnly && s.exportClause && ts.isNamedExports(s.exportClause)) {
      return s.exportClause.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text);
    }
    return [];
  });
}

const NAMED_EXPORT_ROLES = new Set([...CLASS_ROLES, "decorator", "bootstrap"]);

/** `<file>` when a class-role, decorator or bootstrap file exports values but none named after the file. */
export function mainExportViolations(file: string, source: string): string[] {
  if (EXEMPT.has(file) || file.endsWith(".spec.ts")) return [];
  const { parts } = parse(file);
  if (parts.length !== 2 || !NAMED_EXPORT_ROLES.has(parts[1]!)) return [];
  const base = parts[0]!.replace(/-/g, "").toLowerCase();
  const prefix = parts[1] === "bootstrap" ? `bootstrap${base}` : base;
  const values = exportedValues(source);
  if (values.length === 0 || values.some((name) => name.toLowerCase().startsWith(prefix))) return [];
  return [file];
}

/** `<file>: <name>` for each runtime statement in a `.types` or `.document` file. */
export function typeFileViolations(file: string, source: string): string[] {
  const { parts } = parse(file);
  if (parts.length !== 2 || !["types", "document"].includes(parts[1]!)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, false);
  return sf.statements.flatMap((s) => {
    if (
      ts.isImportDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      ts.isExportDeclaration(s) ||
      (ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword))
    ) {
      return [];
    }
    const name =
      (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name
        ? s.name.text
        : ts.isVariableStatement(s)
          ? s.declarationList.declarations.map((d) => d.name.getText(sf)).join(", ")
          : ts.SyntaxKind[s.kind];
    return [`${file}: ${name}`];
  });
}

/** Each type alias declared as `Brand<…>` in the given `.types` sources, mapped to the folder that declares it. */
export function declaredBrands(sources: ReadonlyArray<{ file: string; source: string }>): Map<string, string> {
  const folders = new Map<string, string>();
  for (const { file, source } of sources) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, false);
    for (const s of sf.statements) {
      if (
        ts.isTypeAliasDeclaration(s) &&
        ts.isTypeReferenceNode(s.type) &&
        ts.isIdentifier(s.type.typeName) &&
        s.type.typeName.text === "Brand"
      ) {
        folders.set(s.name.text, parse(file).dir);
      }
    }
  }
  return folders;
}

/** The first brand a type names, alone or inside a union, an array, an object or a type argument. */
function brandIn(type: ts.Node, brands: ReadonlyMap<string, string>): string | undefined {
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && brands.has(type.typeName.text)) {
    return type.typeName.text;
  }
  return ts.forEachChild(type, (child) => brandIn(child, brands));
}

/** The name of the top-level `function` declaration that holds `node`, if one does. */
function enclosingFunctionName(node: ts.Node): string | undefined {
  let top = node;
  while (!ts.isSourceFile(top.parent)) top = top.parent;
  return ts.isFunctionDeclaration(top) ? top.name?.text : undefined;
}

const calleeName = (call: ts.CallExpression): string | undefined =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : ts.isIdentifier(call.expression)
      ? call.expression.text
      : undefined;

const isRulesSource = (file: string) => !file.endsWith(".spec.ts") && parse(file).parts[1] === "rules";

/**
 * `<file>: as <Brand>`, `is <Brand>`, `z.custom<Brand>` or `.brand<` for each place a non-spec source
 * mints a brand outside its minter (`to<Brand>` may cast, `is<Brand>` may narrow), `#n` on repeats.
 */
export function brandCastViolations(file: string, source: string, brands: ReadonlyMap<string, string>): string[] {
  if (file.endsWith(".spec.ts")) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const inMinter = (node: ts.Node, minter: string, brand: string) =>
    isRulesSource(file) && parse(file).dir === brands.get(brand) && enclosingFunctionName(node) === minter;
  const labels: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) {
      const brand = brandIn(n.type, brands);
      if (brand && !inMinter(n, `to${brand}`, brand)) labels.push(`as ${brand}`);
    } else if (ts.isTypePredicateNode(n) && n.type) {
      const brand = brandIn(n.type, brands);
      if (brand && !inMinter(n, `is${brand}`, brand)) labels.push(`is ${brand}`);
    } else if (ts.isCallExpression(n) && n.typeArguments) {
      const brand = n.typeArguments.map((t) => brandIn(t, brands)).find((b) => b !== undefined);
      if (calleeName(n) === "custom" && brand) labels.push(`z.custom<${brand}>`);
      if (calleeName(n) === "brand") labels.push(".brand<");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return numberedKeys(file, labels);
}

/**
 * `<Brand>: 0 minters`, or `<Brand>: <n> minters (<file>#<function>, …)`, unless the `.rules` file of
 * the folder that declares the brand holds exactly one top-level function `is<Brand>` or `to<Brand>`.
 */
export function brandMinterViolations(
  brands: ReadonlyMap<string, string>,
  rulesSources: ReadonlyArray<{ file: string; source: string }>,
): string[] {
  const minters = new Map<string, string[]>();
  for (const { file, source } of rulesSources.filter((r) => isRulesSource(r.file))) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, false);
    for (const s of sf.statements) {
      if (!ts.isFunctionDeclaration(s) || !s.name || !s.body) continue;
      const brand = /^(?:is|to)(.+)$/.exec(s.name.text)?.[1];
      if (brand && brands.get(brand) === parse(file).dir) {
        minters.set(brand, [...(minters.get(brand) ?? []), `${file}#${s.name.text}`]);
      }
    }
  }
  return [...brands.keys()].sort().flatMap((brand) => {
    const found = minters.get(brand) ?? [];
    if (found.length === 1) return [];
    return [found.length === 0 ? `${brand}: 0 minters` : `${brand}: ${found.length} minters (${found.join(", ")})`];
  });
}

describe("naming rules apply as specified", () => {
  it.each([
    "src/building/building.service.ts",
    "src/notices/notice-dispatch.repository.ts",
    "src/notices/notice.document.generated.ts",
    "src/building/building.service.spec.ts",
    "src/shared/regex.util.ts",
    "src/shared/regex.util.spec.ts",
    "src/http/http-app.bootstrap.ts",
    "src/x/x.wire.ts",
    "src/infra/db.ts",
    "src/infra/db.spec.ts",
    "src/infra/nest-logger.ts",
    "src/main.ts",
    "src/notices/notices.topics.ts",
  ])("accepts the suffix of %s", (file) => {
    expect(suffixViolation(file)).toBe(false);
  });

  it.each([
    "src/building/foo.helper.ts",
    "src/building/building.data.ts",
    "src/building/types.ts",
    "src/notices/notices.dedup-key.ts",
    "src/building/foo.util.ts",
    "src/building/a.b.service.ts",
    "src/infra/foo.bar.ts",
  ])("rejects the suffix of %s", (file) => {
    expect(suffixViolation(file)).toBe(true);
  });

  it.each([
    ["src/infra/rateLimitKeys.ts", true],
    ["src/notices/tabConfig.ts", true],
    ["src/notices/notices.dedup-key.ts", false],
    ["src/map/map-layerset.config.ts", false],
  ])("kebab-case of %s violates: %s", (file, violates) => {
    expect(kebabViolation(file)).toBe(violates);
  });

  it("matches class names to file names", () => {
    expect(
      classNameViolations(
        "src/notices/notice-dispatch.repository.ts",
        "export class NoticeDispatchRepository {}\nclass Helper {}",
      ),
    ).toEqual([]);
    expect(
      classNameViolations("src/http/general-rate-limit.middleware.ts", "export class BusRateLimitMiddleware {}"),
    ).toEqual(["src/http/general-rate-limit.middleware.ts: BusRateLimitMiddleware"]);
    expect(
      classNameViolations(
        "src/bus/eta/directions.error.ts",
        "export class DirectionsQuotaError extends Error {}\nexport class Other {}",
      ),
    ).toEqual(["src/bus/eta/directions.error.ts: Other"]);
    expect(classNameViolations("src/building/building.types.ts", "export class Anything {}")).toEqual([]);
  });

  it("keeps exported types in .types, .document and .schema files", () => {
    const service = "src/building/building.service.ts";
    expect(
      exportedTypeViolations(
        service,
        "export interface A {}\nexport type B = string;\ninterface Local {}\nexport class BuildingService {}",
      ),
    ).toEqual([`${service}: A`, `${service}: B`]);
    expect(
      exportedTypeViolations(service, 'type C = 1;\nexport { type C };\nexport type { D } from "./d";'),
    ).toEqual([`${service}: C`, `${service}: D`]);
    expect(exportedTypeViolations("src/building/building.types.ts", "export interface A {}")).toEqual([]);
    expect(exportedTypeViolations("src/building/building.document.ts", "export interface A {}")).toEqual([]);
    expect(exportedTypeViolations("src/building/building.schema.ts", "export type A = 1;")).toEqual([]);
    for (const role of ["rules", "mapper", "query", "config", "util", "bootstrap"]) {
      const file = `src/building/building.${role}.ts`;
      expect(exportedTypeViolations(file, "export interface A {}\nexport function a() {}")).toEqual([`${file}: A`]);
    }
    expect(exportedTypeViolations("src/infra/logger.ts", "export interface A {}")).toEqual([]);
    expect(exportedTypeViolations("src/building/building.service.spec.ts", "export interface A {}")).toEqual([]);
  });

  it("lets a .wire file export its schemas' z.input types next to the schemas", () => {
    // Arrange
    const file = "src/x/x.wire.ts";
    const source = [
      'import { z } from "zod";',
      "export const x = z.object({ name: z.string() });",
      "export type X = z.input<typeof x>;",
    ].join("\n");

    // Act & Assert
    expect(exportedTypeViolations(file, source)).toEqual([]);
    expect(typeFileViolations(file, source)).toEqual([]);
  });

  it("names a role file's main export after the file", () => {
    expect(mainExportViolations("src/http/no-store.middleware.ts", "export function noStoreMiddleware() {}")).toEqual([]);
    expect(mainExportViolations("src/http/no-store.middleware.ts", "export function forceNoStore() {}")).toEqual([
      "src/http/no-store.middleware.ts",
    ]);
    expect(
      mainExportViolations("src/http/cache-control.decorator.ts", "export const KEY = 1;\nexport const CacheControl = () => 1;"),
    ).toEqual([]);
    const bootstrap = "src/http/http-app.bootstrap.ts";
    expect(mainExportViolations(bootstrap, "export async function bootstrapHttpApp() {}")).toEqual([]);
    expect(mainExportViolations(bootstrap, "export async function httpPipelineMiddleware() {}")).toEqual([bootstrap]);
    expect(mainExportViolations(bootstrap, "export async function httpApp() {}")).toEqual([bootstrap]);
    expect(mainExportViolations(bootstrap, "export class HttpAppBootstrap {}")).toEqual([bootstrap]);
    expect(mainExportViolations("src/x/x.rules.ts", "export function anything() {}")).toEqual([]);
    expect(mainExportViolations("src/x/x.service.ts", "export type T = 1;")).toEqual([]);
  });

  it("keeps runtime code out of .types and .document files", () => {
    const source = [
      'import type { A } from "./a";',
      "export interface B { a: A }",
      "export type C = B;",
      "declare const brand: unique symbol;",
      "export function isB(v: unknown): v is B { return true; }",
      "export const KINDS = ['a'] as const;",
      "export enum Kind { A }",
    ].join("\n");
    expect(typeFileViolations("src/x/x.types.ts", source)).toEqual([
      "src/x/x.types.ts: isB",
      "src/x/x.types.ts: KINDS",
      "src/x/x.types.ts: Kind",
    ]);
    expect(typeFileViolations("src/x/x.util.ts", source)).toEqual([]);
  });

  const brandTypes = {
    file: "src/x/x.types.ts",
    source: [
      'import type { Brand } from "../shared/brand.types";',
      'export type XId = Brand<number, "XId">;',
      'export type XCode = Brand<string, "XCode">;',
      "export type Other = number;",
      "export type Alias = XId;",
    ].join("\n"),
  };
  const brands = declaredBrands([brandTypes]);

  it("finds each Brand<…> alias and the folder that declares it", () => {
    // Act & Assert
    expect(brands).toEqual(
      new Map([
        ["XId", "src/x"],
        ["XCode", "src/x"],
      ]),
    );
  });

  it.each([
    [
      "casts in a service, a non-brand cast left alone",
      "src/x/x.service.ts",
      "const a = 1 as XId;\nconst b = (n || null) as XId | null;\nconst c = 2 as Other;",
      ["as XId", "as XId #2"],
    ],
    ["an angle-bracket assertion", "src/x/x.service.ts", "const a = <XId>1;", ["as XId"]],
    ["a cast in a client, once a minting role", "src/x/x.client.ts", "const a = 1 as XId;", ["as XId"]],
    ["a cast in a schema, once a minting role", "src/x/x.schema.ts", "const a = z.number().transform((n) => n as XId);", ["as XId"]],
    ["a type predicate outside is<Brand>", "src/x/x.mapper.ts", "export function ok(v: number): v is XId { return v > 0; }", ["is XId"]],
    ["z.custom of a brand", "src/x/x.schema.ts", "const a = z.custom<XId>((v) => typeof v === 'number');", ["z.custom<XId>"]],
    ["zod's own brand", "src/x/x.schema.ts", 'const a = z.number().brand<"XId">();', [".brand<"]],
    [
      "a cast in the declaring .rules, outside to<Brand>",
      "src/x/x.rules.ts",
      "export function helper(n: number) { return n as XId; }",
      ["as XId"],
    ],
    [
      "a cast inside is<Brand>, which narrows instead",
      "src/x/x.rules.ts",
      "export function isXId(n: number): n is XId { return (n as XId) > 0; }",
      ["as XId"],
    ],
    [
      "a cast to one brand inside another brand's to<Brand>",
      "src/x/x.rules.ts",
      "export function toXCode(id: XId): XCode { return String(id as number as XId) as XCode; }",
      ["as XId"],
    ],
    [
      "a to<Brand> in another role of the declaring folder",
      "src/x/x.mapper.ts",
      "export function toXId(n: number): XId { return n as XId; }",
      ["as XId"],
    ],
    [
      "a minter in another folder's .rules",
      "src/y/y.rules.ts",
      "export function toXId(n: number): XId { return n as XId; }\nexport function isXCode(v: string): v is XCode { return v !== ''; }",
      ["as XId", "is XCode"],
    ],
  ])("brand-casts reports %s", (_case, file, source, labels) => {
    // Act & Assert
    expect(brandCastViolations(file, source, brands)).toEqual(labels.map((label) => `${file}: ${label}`));
  });

  it.each([
    ["the cast in to<Brand> of the declaring .rules", "src/x/x.rules.ts", "export function toXId(n: number): XId {\n  return n as XId;\n}"],
    ["the predicate of is<Brand> there", "src/x/x.rules.ts", "export function isXCode(v: string): v is XCode { return v !== ''; }"],
    ["any cast in a spec", "src/x/x.service.spec.ts", "const a = 1 as XId;\nfunction f(v: number): v is XId { return true; }"],
  ])("brand-casts allows %s", (_case, file, source) => {
    // Act & Assert
    expect(brandCastViolations(file, source, brands)).toEqual([]);
  });

  it.each([
    [
      "one is<Brand> or to<Brand> per brand",
      [["src/x/x.rules.ts", "export function isXId(n: number): n is XId { return n > 0; }\nfunction toXCode(n: XId) {}"]],
      [],
    ],
    [
      "an overloaded minter, counted once",
      [
        [
          "src/x/x.rules.ts",
          "function isXId(n: number): n is XId;\nfunction isXId(n: unknown): n is XId;\nfunction isXId(n: unknown) { return true; }\nfunction toXCode(n: XId) {}",
        ],
      ],
      [],
    ],
    [
      "0 minters",
      [["src/x/x.rules.ts", "export function isXId(n: number): n is XId { return n > 0; }"]],
      ["XCode: 0 minters"],
    ],
    [
      "2 minters",
      [["src/x/x.rules.ts", "function isXId(n: number) {}\nfunction toXId(n: number) {}\nfunction toXCode(n: XId) {}"]],
      ["XId: 2 minters (src/x/x.rules.ts#isXId, src/x/x.rules.ts#toXId)"],
    ],
    [
      "a minter in another folder's .rules or in another role, counted as none",
      [
        ["src/x/x.rules.ts", "function isXId(n: number) {}"],
        ["src/y/y.rules.ts", "function toXCode(n: XId) {}"],
        ["src/x/x.mapper.ts", "function toXCode(n: XId) {}"],
        ["src/x/x.rules.spec.ts", "function toXCode(n: XId) {}"],
      ],
      ["XCode: 0 minters"],
    ],
  ])("brand-minters with %s", (_case, rules, expected) => {
    // Arrange
    const rulesSources = rules.map(([file, source]) => ({ file: file!, source: source! }));

    // Act & Assert
    expect(brandMinterViolations(brands, rulesSources)).toEqual(expected);
  });
});

describe("src/ file and class names", () => {
  const files = filesUnder("src").filter((f) => f.endsWith(".ts"));

  it("use a role from the suffix vocabulary", () => {
    expectAllowlisted("suffix", files.filter(suffixViolation));
  });

  it("are kebab-case", () => {
    expectAllowlisted("kebab-case", files.filter(kebabViolation));
  });

  it("name each exported class after its file", () => {
    expectAllowlisted(
      "class-name",
      files.flatMap((f) => classNameViolations(f, readSource(f))),
    );
  });

  it("name a role file's main export after the file", () => {
    expectAllowlisted(
      "main-export",
      files.flatMap((f) => mainExportViolations(f, readSource(f))),
    );
  });

  it("keep runtime code out of .types and .document files", () => {
    expectAllowlisted(
      "type-files",
      files.flatMap((f) => typeFileViolations(f, readSource(f))),
    );
  });

  const sourcesEndingIn = (suffix: string) =>
    files.filter((f) => f.endsWith(suffix)).map((f) => ({ file: f, source: readSource(f) }));

  it("mint a brand only in its own minter", () => {
    // Arrange
    const brands = declaredBrands(sourcesEndingIn(".types.ts"));

    // Assert
    // A rename of Brand would empty the map and pass both brand rules vacuously.
    expect(brands.size).toBeGreaterThan(0);
    expectAllowlisted(
      "brand-casts",
      files.flatMap((f) => brandCastViolations(f, readSource(f), brands)),
    );
  });

  it("mint each brand in exactly one is<Brand>/to<Brand> in the declaring folder's .rules file", () => {
    // Arrange
    const brands = declaredBrands(sourcesEndingIn(".types.ts"));

    // Act & Assert
    expectAllowlisted("brand-minters", brandMinterViolations(brands, sourcesEndingIn(".rules.ts")));
  });

  it("export no types from a class-role file", () => {
    expectAllowlisted(
      "exported-types",
      files.flatMap((f) => exportedTypeViolations(f, readSource(f))),
    );
  });
});
