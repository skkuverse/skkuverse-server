/**
 * A name means one schema in a module (ADR 0010, D13): no `.schema.ts` and
 * `.wire.ts` of the same top-level module (`src/<module>/`, its sub-modules
 * included) export the same identifier. A `.schema` that wraps a wire schema
 * names the wrapper apart (`homeLayoutFile` wraps the wire's `homeLayout`), so
 * an import never picks one where the other was meant.
 *
 * Names exported in place, through `export { … }`, destructured or
 * re-exported count, types included; an `export * from` a file of this
 * repository counts as all of that file's names.
 *
 * The rule is strict: no allowlist, and no list may hold an entry under src/
 * (scope-entries.test.ts).
 */
import { exportedNamesDeep, exportsOf, parseSource } from "../helpers/architecture/ast";
import { parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "schema-wire-names";

/** The identifiers a source exports: in place, through `export { … }`, destructured or re-exported, types included. */
export function exportedNames(file: string, source: string): string[] {
  return exportsOf(parseSource(file, source)).bindings.map((b) => b.exported);
}

const moduleOf = (file: string): string | undefined => /^src\/([^/]+)\//.exec(file)?.[1];

/** `<module>: <name> (<schema file>, <wire file>)` per name a module's `.schema` and `.wire` files both export, sorted. */
export function schemaWireNameViolations(files: readonly string[], read: (file: string) => string): string[] {
  const byRole = (role: string) =>
    files.filter((f) => f.startsWith("src/") && !f.endsWith(".spec.ts") && parse(f).parts.at(-1) === role);
  const present = new Set(files);
  const namesOf = (file: string): string[] => [...exportedNamesDeep(file, read, present).names];
  const wireNames = byRole("wire").flatMap((file) => namesOf(file).map((name) => ({ file, name })));
  return byRole("schema")
    .flatMap((schemaFile) =>
      namesOf(schemaFile).flatMap((name) =>
        wireNames
          .filter((w) => w.name === name && moduleOf(w.file) === moduleOf(schemaFile))
          .map((w) => `${moduleOf(schemaFile) ?? ""}: ${name} (${schemaFile}, ${w.file})`),
      ),
    )
    .sort();
}

describe("schema/wire name rule applies as specified", () => {
  it("reads names exported in place, through export { … } and re-exported, types included", () => {
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
    expect(exportedNames("src/x/x.schema.ts", source)).toEqual(["a", "A", "B", "toA", "renamed", "fromElsewhere"]);
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

  it.each([
    ["re-exported by name", 'export { xItem } from "./x.wire";'],
    ["re-exported through export *", 'export * from "./x.wire";'],
    ["destructured", "export const { xItem } = obj;"],
  ])("flags a .wire name the .schema exports %s", (_case, schemaSource) => {
    // Arrange
    const sources: Record<string, string> = { "src/x/x.wire.ts": "export const xItem = 1;", "src/x/x.schema.ts": schemaSource };

    // Act
    const violations = schemaWireNameViolations(Object.keys(sources), (file) => sources[file] ?? "");

    // Assert
    expect(violations).toEqual(["x: xItem (src/x/x.schema.ts, src/x/x.wire.ts)"]);
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
