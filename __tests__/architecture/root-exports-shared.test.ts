/**
 * The root of a module with sub-modules holds the code several flows share
 * (ADR 0010, D3): an export of a root `.rules`, `.mapper`, `.schema`,
 * `.types` or `.constants` file is used by the root (another root file, or
 * its own file's other code), imported (value or type) by two or more
 * sub-modules, or imported by another module. One that only a single flow
 * imports belongs in that flow's folder.
 *
 * A brand's minter (`is<Brand>`/`to<Brand>` of a brand the root's `.types`
 * declares) stays with its brand (brand-minters, naming.test.ts) and passes.
 *
 * This rule is a ratchet, `__tests__/architecture/ratchets/root-exports-shared.json`:
 * the root exports that broke it when it was added, in migrated modules, kept
 * there because their flow's role file is at its size cap. Where an export
 * goes when its flow's file is full is ADR 0010 D9's open question; until it
 * is answered the list may only shrink. It sits apart from `allowlists/`, which
 * hold unmigrated debt (migrated-scopes.test.ts).
 */
import path from "path";
import ts from "typescript";
import { ROOT, expectAllowlisted } from "../helpers/architecture/ratchet";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

const RATCHET_DIR = path.join(ROOT, "__tests__/architecture/ratchets");
const SHARED_ROLES = /^src\/([\w-]+)\/\1\.(?:rules|mapper|schema|types|constants)\.ts$/;
const BRAND = /^export type (\w+) = Brand</m;

function exportedNames(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const isExported = (n: ts.Node): boolean =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const names: string[] = [];
  for (const s of sf.statements) {
    if ((ts.isFunctionDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name && isExported(s)) names.push(s.name.text);
    if (ts.isVariableStatement(s) && isExported(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    if (ts.isExportDeclaration(s) && !s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause)) {
      for (const e of s.exportClause.elements) names.push(e.name.text);
    }
  }
  return names;
}

/** `<resolved module>` → the names a source imports from it, value or type. */
function importsOf(file: string, source: string): Map<string, Set<string>> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out = new Map<string, Set<string>>();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.moduleSpecifier.text.startsWith(".")) continue;
    const bindings = s.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), s.moduleSpecifier.text));
    const names = out.get(target) ?? new Set<string>();
    for (const e of bindings.elements) names.add((e.propertyName ?? e.name).text);
    out.set(target, names);
  }
  return out;
}

/** Where a file sits relative to a module: `root`, the sub-module's folder name, or `other`. */
function placeOf(file: string, module: string): string {
  const prefix = `src/${module}/`;
  if (!file.startsWith(prefix)) return "other";
  const rest = file.slice(prefix.length);
  return rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : "root";
}

/** `<file>: <name>` for each root export of a module with sub-modules that fewer than two flows share. */
export function unsharedRootExports(sources: ReadonlyMap<string, string>): string[] {
  const imports = [...sources].map(([file, source]) => [file, importsOf(file, source)] as const);
  const modulesWithSubModules = new Set(
    [...sources.keys()].flatMap((f) => {
      const m = /^src\/([\w-]+)\/[\w-]+\//.exec(f);
      return m ? [m[1]!] : [];
    }),
  );
  return [...sources].flatMap(([file, source]) => {
    const match = SHARED_ROLES.exec(file);
    if (!match || !modulesWithSubModules.has(match[1]!)) return [];
    const module = match[1]!;
    const brands = new Set([...(sources.get(`src/${module}/${module}.types.ts`) ?? "").matchAll(new RegExp(BRAND, "gm"))].map((m) => m[1]!));
    const target = file.replace(/\.ts$/, "");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const usedInFile = new Set<string>();
    const visit = (n: ts.Node): void => {
      const isOwnDeclarationName = n.parent !== undefined && "name" in n.parent && (n.parent as { name?: ts.Node }).name === n;
      if (ts.isIdentifier(n) && !isOwnDeclarationName && !ts.isExportSpecifier(n.parent)) usedInFile.add(n.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return exportedNames(file, source)
      .filter((name) => !brands.has(name.replace(/^(?:is|to)/, "")))
      .filter((name) => {
        const places = new Set(
          imports.filter(([other, byModule]) => other !== file && byModule.get(target)?.has(name)).map(([other]) => placeOf(other, module)),
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

describe("root exports of modules with sub-modules", () => {
  it("are shared by two flows, the root or another module, or wait in the D9 ratchet", () => {
    // Arrange
    const sources = new Map(sourceFiles().map((f) => [f, readSource(f)]));

    // Act
    const violations = unsharedRootExports(sources);

    // Assert
    expectAllowlisted("root-exports-shared", violations, RATCHET_DIR);
  });
});
