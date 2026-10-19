/**
 * Inside a feature, dependencies point from a sub-module to its parent
 * (ADR 0010, D3):
 *
 *   - a child imports anything of its ancestors (their module, providers,
 *     documents, types, rules, mappers, schemas);
 *   - a parent never imports a child: `app.module.ts` registers sub-modules;
 *   - siblings and cousins meet only through a `.module` or `.service`, or
 *     `import type`.
 *
 * A spec follows its subject's direction too, in the module scopes: a root
 * spec that imports a child is testing the child, so it moves to the child's
 * folder. JSON assets are not checked. Imports that leave the feature are the ESLint feature boundaries'
 * job.
 */
import path from "path";
import { importsOf, isSharedLayer, parseSource, resolveRelative } from "../helpers/architecture/ast";
import { inScope, moduleScopes } from "../helpers/architecture/scopes";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { filesUnder, readSource, sourceFiles } from "../helpers/architecture/tree";


/** The relative specifiers a file names, in any form `importsOf` reads, with whether each binding is a type. */
function relativeImports(file: string, source: string): Array<{ spec: string; typeOnly: boolean }> {
  return importsOf(parseSource(file, source))
    .filter((i) => i.specifier.startsWith("."))
    .map((i) => ({ spec: i.specifier, typeOnly: i.isType }));
}

const feature = (file: string) => file.split("/")[1]!;

/**
 * `<importer> → <target>` for each import inside a feature that breaks the child → parent direction.
 * A spec is checked only when `scopes` (the module scopes) hold it.
 */
export function subModuleViolations(file: string, source: string, scopes: readonly string[] = []): string[] {
  const isUncheckedSpec = file.endsWith(".spec.ts") && !scopes.some((scope) => inScope(file, scope));
  if (isUncheckedSpec || isSharedLayer(feature(file))) return [];
  const dir = path.posix.dirname(file);
  const out: string[] = [];
  for (const { spec, typeOnly } of relativeImports(file, source)) {
    if (spec.endsWith(".json")) continue;
    const target = resolveRelative(file, spec) ?? spec;
    if (!target.startsWith("src/") || feature(target) !== feature(file)) continue;
    const targetDir = path.posix.dirname(target);
    const isAncestorOrSelf = dir === targetDir || dir.startsWith(`${targetDir}/`);
    if (isAncestorOrSelf) continue;
    const isDescendant = targetDir.startsWith(`${dir}/`);
    const viaProvider = /\.(?:module|service)$/.test(target);
    if (isDescendant || !(viaProvider || typeOnly)) out.push(`${file} → ${target}`);
  }
  return [...new Set(out)];
}

describe("sub-module direction rule applies as specified", () => {
  it("lets a child import its ancestors, and siblings meet through a module, a service or a type", () => {
    const file = "src/building/search/building-search.service.ts";
    const source = [
      'import { BuildingService } from "../building.service";',
      'import { withCampusLabel } from "../building.mapper";',
      'import type { BuildingDoc } from "../building.document";',
      'import { toSearch } from "./building-search.mapper";',
      'import { BuildingSyncService } from "../sync/building-sync.service";',
      'import type { SyncedSpace } from "../sync/building-sync.types";',
      'import { type ListedBuilding } from "../sync/building-sync.types";',
      'import { AppError } from "../../http/app.error";',
      'import { escapeRegex } from "../../shared/regex.util";',
    ].join("\n");
    expect(subModuleViolations(file, source)).toEqual([]);
  });

  it("rejects a parent importing its child and a sibling's internals", () => {
    expect(
      subModuleViolations(
        "src/building/building.module.ts",
        'import { BuildingSyncModule } from "./sync/building-sync.module";',
      ),
    ).toEqual(["src/building/building.module.ts → src/building/sync/building-sync.module"]);
    expect(
      subModuleViolations(
        "src/building/search/building-search.service.ts",
        'import { enrichBuilding } from "../sync/building-sync.mapper";\nimport { type A, b } from "../sync/building-sync.types";',
      ),
    ).toEqual([
      "src/building/search/building-search.service.ts → src/building/sync/building-sync.mapper",
      "src/building/search/building-search.service.ts → src/building/sync/building-sync.types",
    ]);
  });

  it.each([
    ["an import type", 'type T = import("./sync/building-sync.types").SyncedSpace;'],
    ["an import-equals", 'import sync = require("./sync/building-sync.mapper");'],
    ["a require call", 'const sync = require("./sync/building-sync.mapper");'],
    ["a dynamic import", 'const load = () => import("./sync/building-sync.module");'],
    ["a side-effect import", 'import "./sync/building-sync.module";'],
  ])("rejects a parent reaching its child through %s", (_case, source) => {
    // Arrange
    const file = "src/building/building.service.ts";

    // Act
    const violations = subModuleViolations(file, source);

    // Assert
    expect(violations).toHaveLength(1);
  });

  it("checks a spec in a scope as its subject, and leaves other specs alone", () => {
    // Arrange
    const source = 'import { x } from "./sync/building-sync.mapper";\nimport { BuildingService } from "./building.service";';

    // Act & Assert
    expect(subModuleViolations("src/building/building.service.spec.ts", source, ["src/building/"])).toEqual([
      "src/building/building.service.spec.ts → src/building/sync/building-sync.mapper",
    ]);
    expect(subModuleViolations("src/building/building.service.spec.ts", source, ["src/map/"])).toEqual([]);
  });

  it("leaves specs outside the scopes, JSON assets and shared roles alone", () => {
    expect(subModuleViolations("src/building/building.service.spec.ts", 'import { x } from "./sync/building-sync.mapper";')).toEqual([]);
    expect(subModuleViolations("src/map/map-layerset.config.ts", 'import set from "./config/festival.json";')).toEqual([]);
    expect(subModuleViolations("src/http/x.middleware.ts", 'import { y } from "./sub/y";')).toEqual([]);
  });
});

describe("sub-modules", () => {
  it("depend on their parents, never the reverse, and meet siblings through providers or types", () => {
    const specs = filesUnder("src").filter((f) => f.endsWith(".spec.ts"));
    expectAllowlisted(
      "sub-modules",
      [...sourceFiles(), ...specs].flatMap((f) => subModuleViolations(f, readSource(f), moduleScopes())),
    );
  });
});
