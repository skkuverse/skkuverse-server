/**
 * A `.constants` export is a value production code reads (ADR 0010, D4). A
 * constant that only its own file reads needs no export, and one that only a
 * test reads lets the code that should derive from it restate it instead:
 * adding a block type to `PLACE_BLOCK_TYPES` compiled, while the readers kept
 * their own lists and dropped the new type as unknown.
 *
 * In a module scope, each export of a `.constants.ts` file is imported by
 * name by a non-spec `src/` file other than its own (a relative import that
 * resolves to the constants file). A reasoned exemption is in
 * `exemptions/constants-read.json`.
 */
import ts from "typescript";
import { exportsOf, importsOf, parseSource } from "../helpers/architecture/ast";
import { expectExempted } from "../helpers/architecture/exemptions";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { readSource, sourceFiles } from "../helpers/architecture/tree";

/** The value names a source exports, in place or through `export { … }`; re-exports aside. */
export function exportedValues(file: string, source: string): string[] {
  return exportsOf(parseSource(file, source))
    .bindings.filter((b) => !b.isType && b.kind !== "reexport" && b.kind !== "namespace")
    .map((b) => b.exported);
}

/**
 * `<module path without .ts>` → the value names each source imports from it: by name, or read as
 * `<namespace>.<name>` through `import * as`.
 */
export function importedValues(file: string, source: string): Map<string, Set<string>> {
  const sf = parseSource(file, source);
  const out = new Map<string, Set<string>>();
  const namespaceReads = (local: string): string[] => {
    const names: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === local) names.push(n.name.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return names;
  };
  for (const i of importsOf(sf)) {
    if (i.isType || i.isReexport || !i.specifier.startsWith(".")) continue;
    const names = out.get(i.target) ?? new Set<string>();
    for (const name of i.imported === "*" ? namespaceReads(i.local) : [i.imported]) names.add(name);
    out.set(i.target, names);
  }
  return out;
}

/** `<file>: <name>` for each export of a constants file in the scopes that no other non-spec source imports. */
export function unreadConstants(sources: ReadonlyMap<string, string>, scopes: readonly string[]): string[] {
  const imports = [...sources].map(([file, source]) => [file, importedValues(file, source)] as const);
  return [...sources]
    .filter(([file]) => file.endsWith(".constants.ts") && scopes.some((scope) => inScope(file, scope)))
    .flatMap(([file, source]) => {
      const module = file.replace(/\.ts$/, "");
      return exportedValues(file, source)
        .filter((name) => !imports.some(([other, byModule]) => other !== file && byModule.get(module)?.has(name)))
        .map((name) => `${file}: ${name}`);
    });
}

describe("constants-read rule applies as specified", () => {
  const sources = new Map([
    ["src/x/x.constants.ts", "export const READ = 1;\nexport const OWN = 2;\nconst LOCAL = 3;\nexport const TYPED = 4;\nexport { LOCAL };\nexport const ALIASED = 5;\nconst USES = OWN;"],
    ["src/x/y/x-y.mapper.ts", 'import { READ, ALIASED as A } from "../x.constants";\nimport type { TYPED } from "../x.constants";'],
    ["src/z/z.constants.ts", "export const ORPHAN = 1;"],
  ]);

  it("flags an export only its own file or a type import reads, in the scopes only", () => {
    // Act
    const violations = unreadConstants(sources, ["src/x/"]);

    // Assert
    expect(violations).toEqual(["src/x/x.constants.ts: OWN", "src/x/x.constants.ts: TYPED", "src/x/x.constants.ts: LOCAL"]);
  });

  it("reads an enum and a namespace import's members, and does not count a re-export as a read", () => {
    // Arrange
    const withNamespace = new Map([
      ["src/x/x.constants.ts", "export enum Kind { A }\nexport const NS = 1;\nexport const RE = 2;\nexport const UNREAD = 3;"],
      ["src/x/x.mapper.ts", 'import * as C from "./x.constants";\nexport const f = (): number => C.NS;'],
      ["src/x/x.barrel.ts", 'export { RE } from "./x.constants";'],
    ]);

    // Act
    const violations = unreadConstants(withNamespace, ["src/x/"]);

    // Assert
    expect(violations).toEqual(["src/x/x.constants.ts: Kind", "src/x/x.constants.ts: RE", "src/x/x.constants.ts: UNREAD"]);
  });
});

describe("constants in the module scopes", () => {
  it("are exported only when other production code reads them", () => {
    // Arrange
    const sources = new Map(sourceFiles().map((f) => [f, readSource(f)]));

    // Act
    const violations = unreadConstants(sources, moduleScopes());

    // Assert
    expectExempted("constants-read", violations);
  });
});
