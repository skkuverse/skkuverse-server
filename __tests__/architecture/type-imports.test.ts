/**
 * A type one feature takes from another comes from a file that declares
 * types (ADR 0010, D4): a type-only binding (`import type { … }`, or
 * `import { type X }`) whose specifier leaves its feature for another one
 * (`src/<a>/…` importing `src/<b>/…`) names a `.types`, `.document`,
 * `.schema` or `.wire` file. The feature's door, its `.module` and
 * `.service`, may be imported as a type too: a class injected by DI is
 * named by its own file. Shared folders (config, http, infra, scheduling,
 * shared) are not features. Specs are checked like sources.
 *
 * Type-only re-exports (`export type { X } from`), `export * from` and
 * `import("…").X` types count as type bindings too, and a folder import
 * (`"../../miniapps"`) names no type file.
 *
 * A value import across features is the ESLint feature boundary's
 * (eslint.config.js, `boundaries/feature/…`), which lets every type import
 * through; this rule says where those types come from.
 *
 * The allowlist holds the imports of modules not yet migrated; a migrated
 * scope carries no entry (migrated-scopes.test.ts).
 */
import { importsOf, isSharedLayer, parseSource } from "../helpers/architecture/ast";
import { parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource } from "../helpers/architecture/tree";

const RULE = "type-imports";
const TYPE_SOURCE_ROLES = new Set(["types", "document", "schema", "wire", "service", "module"]);

/** The feature a repo path (a file, or a module path without `.ts`) belongs to; undefined for a shared layer. */
const featureOf = (target: string): string | undefined => {
  const top = /^src\/([^/.]+)(?:\/|$)/.exec(target)?.[1];
  return top === undefined || isSharedLayer(top) ? undefined : top;
};

/** `<file> → <target>: <names>` for each type-only binding taken from another feature's non-type file. */
export function typeImportViolations(file: string, source: string): string[] {
  const own = featureOf(file);
  if (own === undefined || !file.endsWith(".ts")) return [];
  const byTarget = new Map<string, string[]>();
  for (const i of importsOf(parseSource(file, source))) {
    const isTypeBinding = i.isType || (i.isReexport && i.imported === "*");
    if (!isTypeBinding || !i.specifier.startsWith(".")) continue;
    const other = featureOf(i.target);
    if (other === undefined || other === own) continue;
    const { parts } = parse(`${i.target}.ts`);
    if (parts.length > 1 && TYPE_SOURCE_ROLES.has(parts.at(-1) ?? "")) continue;
    byTarget.set(i.target, [...(byTarget.get(i.target) ?? []), i.local]);
  }
  return [...byTarget].map(([target, names]) => `${file} → ${target}: ${names.join(", ")}`);
}

describe("type import rule applies as specified", () => {
  const file = "src/ui/home/ui-home.mapper.ts";

  it.each([
    ["a type file", 'import type { BusGroup } from "../../bus/bus-config/bus-config.types";'],
    ["a document", 'import type { BuildingDoc } from "../../building/building.document";'],
    ["a schema and a wire", 'import type { A } from "../../map/map.schema";\nimport { type B } from "../../map/map.wire";'],
    ["the feature's service and module", 'import type { MiniappsService } from "../../miniapps/miniapps.service";\nimport type { M } from "../../miniapps/miniapps.module";'],
    ["its own feature", 'import type { X } from "../ui.rules";\nimport type { Y } from "./ui-home.mapper";'],
    ["a shared folder", 'import type { SupportedLang } from "../../infra/types";\nimport type { L } from "../../shared/link-action.wire";'],
    ["a value import, the feature boundary's to judge", 'import { helper } from "../../bus/bus-config/bus-config.data";'],
    ["a package", 'import type { Filter } from "mongodb";'],
  ])("passes a type import from %s", (_case, source) => {
    // Act & Assert
    expect(typeImportViolations(file, source)).toEqual([]);
  });

  it.each([
    ["import type from a bare types.ts", 'import type { MiniAppLogo, MiniAppLogoRaw } from "../../miniapps/types";', "src/miniapps/types: MiniAppLogo, MiniAppLogoRaw"],
    ["an inline type binding from a rules file", 'import { type Rule, value } from "../../bus/bus.rules";', "src/bus/bus.rules: Rule"],
    ["a default type import from a mapper", 'import type Thing from "../../map/map.mapper";', "src/map/map.mapper: Thing"],
    ["a namespace type import from a data file", 'import type * as data from "../../bus/bus-config/bus-config.data";', "src/bus/bus-config/bus-config.data: data"],
    ["a type re-export from a rules file", 'export type { Rule } from "../../bus/bus.rules";', "src/bus/bus.rules: Rule"],
    ["an inline type re-export", 'export { type Rule } from "../../bus/bus.rules";', "src/bus/bus.rules: Rule"],
    ["an export * from a rules file", 'export * from "../../bus/bus.rules";', "src/bus/bus.rules: *"],
    ["an import type", 'type L = import("../../miniapps/types").MiniAppLogo;', "src/miniapps/types: MiniAppLogo"],
    ["a folder import", 'import type { X } from "../../miniapps";', "src/miniapps: X"],
  ])("fails %s", (_case, source, label) => {
    // Act & Assert
    expect(typeImportViolations(file, source)).toEqual([`${file} → ${label}`]);
  });

  it("checks specs too, and no file outside a feature", () => {
    // Arrange
    const source = 'import type { MiniAppLogo } from "../../miniapps/types";';

    // Act & Assert
    expect(typeImportViolations("src/ui/home/ui-home.mapper.spec.ts", source)).toHaveLength(1);
    expect(typeImportViolations("src/infra/x/y.ts", source)).toEqual([]);
    expect(typeImportViolations("scripts/x/y.ts", source)).toEqual([]);
  });
});

describe("src/ type imports across features", () => {
  it("come from a type file, or the feature's service or module", () => {
    // Arrange
    const files = filesUnder("src").filter((f) => f.endsWith(".ts"));

    // Act & Assert
    expectAllowlisted(RULE, files.flatMap((f) => typeImportViolations(f, readSource(f))));
  });
});
