/**
 * The root of a module with sub-modules holds the code several flows share
 * (ADR 0010, D3): an export of a root `.rules`, `.mapper`, `.schema`,
 * `.types` or `.constants` file is used by the root (another root file, or
 * its own file's other code), imported (value or type) by two or more
 * sub-modules, or imported by another module. One that only a single flow
 * imports belongs in that flow's folder.
 *
 * A brand's minter (`is<Brand>`/`to<Brand>` in the root `.rules` of a brand
 * the root's `.types` declares) stays with its brand (brand-minters,
 * naming.test.ts) and passes. So does a root declaration's own guard or
 * derived type: an `is<T>` type guard whose `T` the root's `.types` or
 * `.constants` declares (`isCampus` for `Campus`), or a type alias built from
 * them (`(typeof BASE_LAYERS)[number]`). A use in its own file is resolved by
 * symbol, so a parameter that shadows the export's name is not one; a
 * namespace import counts the members it reads.
 *
 * A sub-module that has sub-modules of its own (`src/bus/eta/`, whose flows
 * are `live/`, `baseline/` and `smart/`) is a root too, held the same way: its
 * flows are its own sub-folders, and any file outside it is another module.
 *
 * Where an export goes when its flow's role file is at its size cap is ADR
 * 0010 D9's: the file splits along a domain seam, never overflowing into
 * another role file or the module root, and a file with no seam takes a
 * reasoned per-file cap in `exemptions/size-caps.json`.
 */
import ts from "typescript";
import { exportsOf, importsOf, parseSource, type ExportedBinding } from "../helpers/architecture/ast";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const SHARED_ROLES = /^(src(?:\/[\w-]+)+)\/([\w-]+)\.(?:rules|mapper|schema|types|constants)\.ts$/;
const BRAND = /^export type (\w+) = Brand</m;

/** `<resolved module>` → the names a source imports from it, value or type; a namespace import by the members it reads. */
function importsByModule(file: string, source: string): Map<string, Set<string>> {
  const sf = parseSource(file, source);
  const out = new Map<string, Set<string>>();
  const membersRead = (local: string): string[] => {
    const names: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === local) names.push(n.name.text);
      if (ts.isQualifiedName(n) && ts.isIdentifier(n.left) && n.left.text === local) names.push(n.right.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return names;
  };
  for (const i of importsOf(sf)) {
    if (!i.specifier.startsWith(".")) continue;
    const names = out.get(i.target) ?? new Set<string>();
    for (const name of i.imported === "*" ? membersRead(i.local) : [i.imported]) names.add(name);
    out.set(i.target, names);
  }
  return out;
}

/**
 * The exported names a source's own code reads, resolved by symbol: a parameter or local that shadows an
 * export's name is not a use of the export.
 */
export function namesUsedInFile(file: string, source: string): Set<string> {
  const sf = parseSource(file, source);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === file ? sf : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => name === file,
    readFile: () => undefined,
  };
  const checker = ts.createProgram([file], { noLib: true, noResolve: true, types: [] }, host).getTypeChecker();
  const topLevel = new Map<ts.Symbol, string>();
  for (const b of exportsOf(sf).bindings) {
    const name = b.declaration && (b.declaration as { name?: ts.Node }).name;
    const symbol = name ? checker.getSymbolAtLocation(name) : undefined;
    if (symbol) topLevel.set(symbol, b.exported);
  }
  const used = new Set<string>();
  const visit = (n: ts.Node): void => {
    const isOwnDeclarationName = n.parent !== undefined && "name" in n.parent && (n.parent as { name?: ts.Node }).name === n;
    if (ts.isIdentifier(n) && !isOwnDeclarationName && !ts.isExportSpecifier(n.parent)) {
      const symbol = checker.getSymbolAtLocation(n);
      const exported = symbol ? topLevel.get(symbol) : undefined;
      if (exported !== undefined) used.add(exported);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return used;
}

/** A module folder's base, as its role files are named: `src/bus/eta` → `bus-eta`. */
function baseOf(dir: string): string {
  return dir.split("/").slice(1).join("-");
}

/** The names a root `.types` or `.constants` file of the module at `dir` declares. */
function rootTypeAndConstantNames(dir: string, sources: ReadonlyMap<string, string>): Set<string> {
  const base = baseOf(dir);
  return new Set(
    ["types", "constants"].flatMap((role) => {
      const file = `${dir}/${base}.${role}.ts`;
      const source = sources.get(file);
      return source === undefined ? [] : exportsOf(parseSource(file, source)).bindings.map((b) => b.exported);
    }),
  );
}

/** The identifiers a type node names: `Campus` in `value is Campus`, `BASE_LAYERS` in `(typeof BASE_LAYERS)[number]`. */
function typeNodeNames(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) names.push(n.typeName.text);
    if (ts.isTypeQueryNode(n) && ts.isIdentifier(n.exprName)) names.push(n.exprName.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/**
 * A root declaration's own guard or derived type, which stays beside it: an `is<T>` type guard whose `T` the root's
 * `.types` or `.constants` declares, or a type alias built from those declarations.
 */
function isGuardOrDerivedType(b: ExportedBinding, rootNames: ReadonlySet<string>): boolean {
  const d = b.declaration;
  if (d === undefined) return false;
  if (ts.isTypeAliasDeclaration(d)) return typeNodeNames(d.type).some((n) => rootNames.has(n));
  const fn = ts.isFunctionDeclaration(d) ? d : undefined;
  const type = fn?.type;
  return type !== undefined && ts.isTypePredicateNode(type) && type.type !== undefined && typeNodeNames(type.type).some((n) => rootNames.has(n));
}

/** Where a file sits relative to the module at `dir`: `root`, the sub-module's folder name, or `other`. */
function placeOf(file: string, dir: string): string {
  const prefix = `${dir}/`;
  if (!file.startsWith(prefix)) return "other";
  const rest = file.slice(prefix.length);
  return rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : "root";
}

/** The module folders, at any depth, that hold a sub-module: every folder above a source's own. */
function rootsWithSubModules(files: Iterable<string>): Set<string> {
  return new Set(
    [...files].flatMap((f) => {
      const dirs = f.split("/").slice(0, -1);
      return dirs.slice(2).map((_, i) => dirs.slice(0, i + 2).join("/"));
    }),
  );
}

/** `<file>: <name>` for each root export of a module or sub-module with sub-modules that fewer than two flows share. */
export function unsharedRootExports(sources: ReadonlyMap<string, string>): string[] {
  const imports = [...sources].map(([file, source]) => [file, importsByModule(file, source)] as const);
  const roots = rootsWithSubModules(sources.keys());
  return [...sources].flatMap(([file, source]) => {
    const match = SHARED_ROLES.exec(file);
    if (!match || !roots.has(match[1]!) || match[2] !== baseOf(match[1]!)) return [];
    const dir = match[1]!;
    const brands = new Set([...(sources.get(`${dir}/${baseOf(dir)}.types.ts`) ?? "").matchAll(new RegExp(BRAND, "gm"))].map((m) => m[1]!));
    const isMinter = (b: ExportedBinding): boolean =>
      file.endsWith(".rules.ts") && b.kind === "function" && /^(?:is|to)/.test(b.exported) && brands.has(b.exported.replace(/^(?:is|to)/, ""));
    const rootNames = rootTypeAndConstantNames(dir, sources);
    const target = file.replace(/\.ts$/, "");
    const usedInFile = namesUsedInFile(file, source);
    return exportsOf(parseSource(file, source))
      .bindings.filter((b) => b.kind !== "reexport")
      .filter((b) => !brands.has(b.exported) && !isMinter(b) && !isGuardOrDerivedType(b, rootNames))
      .map((b) => b.exported)
      .filter((name) => {
        const places = new Set(
          imports.filter(([other, byModule]) => other !== file && byModule.get(target)?.has(name)).map(([other]) => placeOf(other, dir)),
        );
        const flows = [...places].filter((p) => p !== "root" && p !== "other");
        return !(usedInFile.has(name) || places.has("root") || places.has("other") || flows.length >= 2);
      })
      .map((name) => `${file}: ${name}`);
  });
}

describe("root-exports-shared rule applies as specified", () => {
  it("passes an export the root (its own file included), two flows or another module reads, and a brand's minter; flags the rest", () => {
    // Arrange
    const sources = new Map([
      ["src/x/x.types.ts", 'export type XId = Brand<number, "XId">;\nexport type Shared = 1;'],
      [
        "src/x/x.rules.ts",
        "export function isXId(n: number): n is XId { return true; }\nexport const ROOT_READ = 1;\nexport const TWO_FLOWS = 2;\nexport const ONE_FLOW = 3;\nexport const ELSEWHERE = 4;\nexport const NOBODY = 5;\nexport const OWN_READ = 6;\nexport const DERIVED = OWN_READ + 1;",
      ],
      ["src/x/x.schema.ts", 'import { ROOT_READ } from "./x.rules";'],
      ["src/x/a/x-a.service.ts", 'import { TWO_FLOWS, ONE_FLOW } from "../x.rules";\nimport type { Shared } from "../x.types";'],
      ["src/x/b/x-b.mapper.ts", 'import { TWO_FLOWS } from "../x.rules";'],
      ["src/z/z.service.ts", 'import { ELSEWHERE } from "../x/x.rules";'],
      ["src/y/y.rules.ts", "export const FLAT = 1;"],
    ]);

    // Act
    const violations = unsharedRootExports(sources);

    // Assert
    expect(violations).toEqual(["src/x/x.types.ts: Shared", "src/x/x.rules.ts: ONE_FLOW", "src/x/x.rules.ts: NOBODY", "src/x/x.rules.ts: DERIVED"]);
  });
});

describe("root-exports-shared rule reads uses by symbol and keeps guards with their type", () => {
  it("does not count a shadowing local as a use, and counts a namespace import's members", () => {
    // Arrange
    const sources = new Map([
      ["src/x/x.rules.ts", "export const ONE_FLOW = 1;\nfunction g(ONE_FLOW: number): number { return ONE_FLOW; }\nexport const NS_ONLY = 2;"],
      ["src/x/a/x-a.service.ts", 'import { ONE_FLOW } from "../x.rules";\nimport * as R from "../x.rules";\nR.NS_ONLY;'],
      ["src/x/b/x-b.service.ts", 'import * as R from "../x.rules";\nR.NS_ONLY;'],
    ]);

    // Act
    const violations = unsharedRootExports(sources);

    // Assert
    expect(violations).toEqual(["src/x/x.rules.ts: ONE_FLOW"]);
  });

  it("passes a guard of a root type and a type derived from a root constant, and only a brand's own minter", () => {
    // Arrange
    const sources = new Map([
      ["src/x/x.constants.ts", 'export const KINDS = ["a"] as const;\nexport const USED = 1;'],
      ["src/x/x.types.ts", 'export type Kind = (typeof KINDS)[number];\nexport type XId = Brand<number, "XId">;\nexport type Other = string;'],
      [
        "src/x/x.rules.ts",
        "export function isKind(v: unknown): v is Kind { return true; }\nexport function isOther(v: unknown): v is string { return true; }\nexport function isXId(n: number): n is XId { return true; }",
      ],
      ["src/x/x.mapper.ts", "export function toXId(n: number): number { return n; }"],
      ["src/x/a/x-a.service.ts", 'import { KINDS, USED } from "../x.constants";\nimport type { Other } from "../x.types";'],
      ["src/x/b/x-b.service.ts", 'import { KINDS, USED } from "../x.constants";\nimport type { Other } from "../x.types";'],
    ]);

    // Act
    const violations = unsharedRootExports(sources);

    // Assert
    expect(violations).toEqual(["src/x/x.rules.ts: isOther", "src/x/x.mapper.ts: toXId"]);
  });
});

describe("root-exports-shared rule applies to nested module roots", () => {
  it("holds a sub-module with sub-modules of its own to the same rule, its flows being its own sub-folders", () => {
    // Arrange
    const sources = new Map([
      ["src/x/y/x-y.types.ts", 'export type YId = Brand<number, "YId">;'],
      [
        "src/x/y/x-y.rules.ts",
        "export function isYId(n: number): n is YId { return true; }\nexport const ONE_FLOW = 1;\nexport const TWO_FLOWS = 2;\nexport const ELSEWHERE = 3;\nexport const PARENT_READ = 4;",
      ],
      ["src/x/y/a/x-y-a.service.ts", 'import { ONE_FLOW, TWO_FLOWS } from "../x-y.rules";'],
      ["src/x/y/b/x-y-b.mapper.ts", 'import { TWO_FLOWS } from "../x-y.rules";'],
      ["src/x/z/x-z.service.ts", 'import { ELSEWHERE } from "../y/x-y.rules";'],
      ["src/x/x.service.ts", 'import { PARENT_READ } from "./y/x-y.rules";'],
      ["src/x/w/x-w.rules.ts", "export const FLAT = 1;"],
    ]);

    // Act
    const violations = unsharedRootExports(sources);

    // Assert
    expect(violations).toEqual(["src/x/y/x-y.rules.ts: ONE_FLOW"]);
  });
});

describe("root exports of modules with sub-modules", () => {
  it("are shared by two flows, the root or another module", () => {
    // Arrange
    const sources = new Map(sourceFiles().map((f) => [f, readSource(f)]));

    // Act
    const violations = unsharedRootExports(sources);

    // Assert
    expect(violations).toEqual([]);
  });
});
