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
 *   - exported types: only a `.types`, `.document` or `.schema` file exports an
 *     interface or type alias; a type used inside one file stays there,
 *     unexported. src/infra/ files, named by resource, are not checked.
 *   - main export: a class-role, `.decorator` or `.bootstrap` file exports
 *     something named after the file, so either can be found from the other:
 *     a class `NoStoreMiddleware`, a function `noStoreMiddleware`, a decorator
 *     `CacheControl`. A `.bootstrap` file builds the app or applies the
 *     app-wide pipeline, so its function opens with the verb:
 *     `http-app.bootstrap.ts` exports `bootstrapHttpApp`.
 *   - type files: a `.types` or `.document` file holds no runtime code.
 *   - brand casts: a brand type (an alias of `Brand<…>` in a `.types` file) is
 *     cast with `as` only where a value enters: `.client`, `.schema` and
 *     `.rules` files, and specs.
 */
import ts from "typescript";
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

const TYPE_ROLES = new Set(["types", "document", "schema"]);

/** `<file>: <type>` for each type a role file other than `.types`, `.document` or `.schema` exports. */
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

/** Names of the type aliases declared as `Brand<…>` in the given `.types` sources. */
export function brandNames(sources: ReadonlyArray<{ file: string; source: string }>): Set<string> {
  const names = new Set<string>();
  for (const { file, source } of sources) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    for (const s of sf.statements) {
      if (ts.isTypeAliasDeclaration(s) && /^Brand</.test(s.type.getText(sf))) names.add(s.name.text);
    }
  }
  return names;
}

const MINTING_ROLES = new Set(["client", "schema", "rules"]);

/** `<file>: as <Brand>` for each cast to a brand outside the files that mint them, `#n` on repeats. */
export function brandCastViolations(file: string, source: string, brands: ReadonlySet<string>): string[] {
  if (file.endsWith(".spec.ts")) return [];
  const { parts } = parse(file);
  if (parts.length === 2 && MINTING_ROLES.has(parts[1]!)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const seen = new Map<string, number>();
  const out: string[] = [];
  const brandIn = (type: ts.TypeNode): string | undefined => {
    let found: string | undefined;
    const visit = (n: ts.Node): void => {
      if (!found && ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && brands.has(n.typeName.text)) {
        found = n.typeName.text;
      }
      ts.forEachChild(n, visit);
    };
    visit(type);
    return found;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) {
      const brand = brandIn(n.type);
      if (brand) {
        const k = (seen.get(brand) ?? 0) + 1;
        seen.set(brand, k);
        out.push(`${file}: as ${brand}${k > 1 ? ` #${k}` : ""}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
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

  it("allows a brand cast only where a value enters", () => {
    const brands = brandNames([
      { file: "src/x/x.types.ts", source: 'export type XId = Brand<number, "XId">;\nexport type Other = number;' },
    ]);
    expect([...brands]).toEqual(["XId"]);
    const cast = "const a = 1 as XId;\nconst b = (n || null) as XId | null;\nconst c = 2 as Other;";
    expect(brandCastViolations("src/x/x.service.ts", cast, brands)).toEqual([
      "src/x/x.service.ts: as XId",
      "src/x/x.service.ts: as XId #2",
    ]);
    for (const file of ["src/x/x.client.ts", "src/x/x.schema.ts", "src/x/x.rules.ts", "src/x/x.service.spec.ts"]) {
      expect(brandCastViolations(file, cast, brands)).toEqual([]);
    }
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

  it("cast to a brand only in client, schema, rules and spec files", () => {
    const brands = brandNames(
      files.filter((f) => f.endsWith(".types.ts")).map((f) => ({ file: f, source: readSource(f) })),
    );
    expectAllowlisted(
      "brand-casts",
      files.flatMap((f) => brandCastViolations(f, readSource(f), brands)),
    );
  });

  it("export no types from a class-role file", () => {
    expectAllowlisted(
      "exported-types",
      files.flatMap((f) => exportedTypeViolations(f, readSource(f))),
    );
  });
});
