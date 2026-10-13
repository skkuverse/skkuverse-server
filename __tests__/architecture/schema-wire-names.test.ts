/**
 * A name means one schema in a module (ADR 0010, D13): no `.schema.ts` and
 * `.wire.ts` of the same top-level module (`src/<module>/`, its sub-modules
 * included) export the same identifier. A `.schema` that wraps a wire schema
 * names the wrapper apart (`homeLayoutFile` wraps the wire's `homeLayout`), so
 * an import never picks one where the other was meant.
 *
 * Names exported in place and through `export { … }` count, types included;
 * a re-export from another file is not read.
 *
 * The allowlist holds the names of modules not yet migrated; a migrated scope
 * carries no entry (migrated-scopes.test.ts).
 */
import ts from "typescript";
import { parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "schema-wire-names";

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** The identifiers a source exports in place or through a local `export { … }`. */
export function exportedNames(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sf.statements.flatMap((s) => {
    if (ts.isExportDeclaration(s)) {
      if (s.moduleSpecifier || !s.exportClause || !ts.isNamedExports(s.exportClause)) return [];
      return s.exportClause.elements.map((e) => e.name.text);
    }
    if (!isExported(s)) return [];
    if (ts.isVariableStatement(s)) {
      return s.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
    }
    const named =
      ts.isFunctionDeclaration(s) ||
      ts.isClassDeclaration(s) ||
      ts.isEnumDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      ts.isTypeAliasDeclaration(s);
    return named && s.name ? [s.name.text] : [];
  });
}

const moduleOf = (file: string): string | undefined => /^src\/([^/]+)\//.exec(file)?.[1];

/** `<module>: <name> (<schema file>, <wire file>)` per name a module's `.schema` and `.wire` files both export, sorted. */
export function schemaWireNameViolations(files: readonly string[], read: (file: string) => string): string[] {
  const byRole = (role: string) =>
    files.filter((f) => f.startsWith("src/") && !f.endsWith(".spec.ts") && parse(f).parts.at(-1) === role);
  const wireNames = byRole("wire").flatMap((file) => exportedNames(file, read(file)).map((name) => ({ file, name })));
  return byRole("schema")
    .flatMap((schemaFile) =>
      exportedNames(schemaFile, read(schemaFile)).flatMap((name) =>
        wireNames
          .filter((w) => w.name === name && moduleOf(w.file) === moduleOf(schemaFile))
          .map((w) => `${moduleOf(schemaFile) ?? ""}: ${name} (${schemaFile}, ${w.file})`),
      ),
    )
    .sort();
}

describe("schema/wire name rule applies as specified", () => {
  it("reads names exported in place and through export { … }, types included, but not re-exports", () => {
    // Arrange
    const source = [
      'import { z } from "zod";',
      "export const a = z.string();",
      "export type A = z.output<typeof a>;",
      "export interface B {}",
      "export function toA(): void {}",
      "const local = 1;",
      "export { local as renamed };",
      'export { fromElsewhere } from "./other";',
    ].join("\n");

    // Act & Assert
    expect(exportedNames("src/x/x.schema.ts", source)).toEqual(["a", "A", "B", "toA", "renamed"]);
  });

  it("flags a name a module's .schema and .wire both export, across its sub-modules too", () => {
    // Arrange
    const sources: Record<string, string> = {
      "src/x/x.wire.ts": "export const xItem = 1;\nexport type XItem = number;",
      "src/x/x.schema.ts": "export const xItem = 2;\nexport const xItemFile = 3;",
      "src/x/y/x-y.schema.ts": "export type XItem = string;",
    };

    // Act
    const violations = schemaWireNameViolations(Object.keys(sources), (file) => sources[file] ?? "");

    // Assert
    expect(violations).toEqual([
      "x: XItem (src/x/y/x-y.schema.ts, src/x/x.wire.ts)",
      "x: xItem (src/x/x.schema.ts, src/x/x.wire.ts)",
    ]);
  });

  it("passes the same name in two modules, in other roles and in specs", () => {
    // Arrange
    const sources: Record<string, string> = {
      "src/x/x.wire.ts": "export const item = 1;",
      "src/y/y.schema.ts": "export const item = 2;",
      "src/x/x.types.ts": "export type item = number;",
      "src/x/x.schema.spec.ts": "export const item = 3;",
      "src/x/x.mapper.ts": "export const item = 4;",
    };

    // Act & Assert
    expect(schemaWireNameViolations(Object.keys(sources), (file) => sources[file] ?? "")).toEqual([]);
  });
});

describe("src/ .schema and .wire files", () => {
  it("export no identifier twice within a module", () => {
    // Act & Assert
    expectAllowlisted(RULE, schemaWireNameViolations(filesUnder("src"), readSource));
  });
});
