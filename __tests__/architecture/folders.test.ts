/**
 * A folder below a top-level src/ folder is one of two things (ADR 0010, D3):
 *
 *   - a Nest sub-module: it holds its own `*.module.ts`;
 *   - a static-asset folder: it holds JSON files only (read by a sibling
 *     `*.config.ts`).
 *
 * Layer folders (`controllers/`) and grab-bag folders are neither.
 *
 * A top-level src/ folder is a shared role (SHARED_ROLES) or a feature that
 * holds `<name>/<name>.module.ts`, so a new folder is either a module or a
 * decision to add a shared role here.
 *
 * A module folder holds at most one file per role, and every role file is
 * named after the folder's module: `src/building/building.service.ts`,
 * `src/building/sync/building-sync.service.ts`. A flow that needs a second
 * repository, mapper or controller becomes a sub-module, whatever its size; a
 * sub-module's name starts with its feature's (`building-sync`).
 *
 * A module folder that has a sub-module keeps no flow of its own: no
 * controller and no poller at its root. Its first flow is a sub-module too
 * (`src/building/catalog/`), and the root keeps the module file and the code
 * its flows share, so every flow of a split module has the same shape.
 */
import { EXEMPT, ROLES, parse } from "../helpers/architecture/names";
import { expectAllowlisted } from "../helpers/architecture/ratchet";
import { dirsUnder, filesUnder } from "../helpers/architecture/tree";

const SHARED_ROLES = new Set(["config", "http", "infra", "scheduling", "shared"]);

/** `src/<name>/` for each top-level folder that is neither a shared role nor a feature module. */
export function topLevelViolations(files: readonly string[]): string[] {
  const top = [...new Set(files.map((f) => f.split("/")).filter((p) => p.length > 2).map((p) => p[1]!))];
  return top
    .filter((name) => !SHARED_ROLES.has(name) && !files.includes(`src/${name}/${name}.module.ts`))
    .map((name) => `src/${name}/`)
    .sort();
}

export function folderViolation(dir: string, filesBelow: readonly string[]): boolean {
  const direct = filesBelow.filter((f) => !f.slice(dir.length + 1).includes("/"));
  if (direct.some((f) => f.endsWith(".module.ts"))) return false;
  const jsonOnly = filesBelow.length > 0 && filesBelow.every((f) => f.endsWith(".json"));
  return !jsonOnly;
}

/**
 * `<dir>/: <role>` for a role a module folder holds twice, and `<file>: base`
 * for a role file not named after the folder's module (or a sub-module not
 * named after its feature). Specs, generated files and JSON do not count.
 */
export function folderRoleViolations(files: readonly string[]): string[] {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const dir = file.slice(0, file.lastIndexOf("/"));
    byDir.set(dir, [...(byDir.get(dir) ?? []), file]);
  }
  const out: string[] = [];
  for (const [dir, direct] of byDir) {
    const segments = dir.split("/");
    if (segments.length < 2 || SHARED_ROLES.has(segments[1]!)) continue;
    const moduleFile = direct.find((f) => f.endsWith(".module.ts"));
    if (!moduleFile) continue;
    const moduleBase = parse(moduleFile).parts[0]!;
    if (segments.length > 2 && !moduleBase.startsWith(`${segments[1]}-`)) out.push(`${moduleFile}: base`);
    const counts = new Map<string, number>();
    for (const file of direct) {
      if (!file.endsWith(".ts") || file.endsWith(".spec.ts") || file.includes(".generated.") || EXEMPT.has(file)) {
        continue;
      }
      const { parts } = parse(file);
      if (parts.length !== 2 || !ROLES.has(parts[1]!)) continue;
      counts.set(parts[1]!, (counts.get(parts[1]!) ?? 0) + 1);
      if (parts[0] !== moduleBase) out.push(`${file}: base`);
    }
    for (const [role, n] of counts) if (n > 1) out.push(`${dir}/: ${role}`);
  }
  return out.sort();
}

/** Each `.controller` or `.poller` sitting in a module folder that also has a sub-module. */
export function splitRootViolations(files: readonly string[]): string[] {
  const moduleDirs = new Set(
    files.filter((f) => f.endsWith(".module.ts")).map((f) => f.slice(0, f.lastIndexOf("/"))),
  );
  const hasSubModule = (dir: string) =>
    [...moduleDirs].some((d) => d.startsWith(`${dir}/`) && !d.slice(dir.length + 1).includes("/"));
  return files
    .filter((f) => /\.(?:controller|poller)\.ts$/.test(f))
    .filter((f) => {
      const dir = f.slice(0, f.lastIndexOf("/"));
      return moduleDirs.has(dir) && hasSubModule(dir);
    })
    .sort();
}

describe("folder rule applies as specified", () => {
  it("accepts a sub-module and a JSON asset folder", () => {
    expect(folderViolation("src/bus/eta", ["src/bus/eta/eta.module.ts", "src/bus/eta/eta.service.ts"])).toBe(
      false,
    );
    expect(folderViolation("src/map/config", ["src/map/config/eskara-2026.json"])).toBe(false);
    expect(
      folderViolation("src/miniapps/details", ["src/miniapps/details/a.json", "src/miniapps/details/b/c.json"]),
    ).toBe(false);
  });

  it("rejects a layer folder, a mixed folder and a module file one level down", () => {
    expect(folderViolation("src/bus/controllers", ["src/bus/controllers/x.controller.ts"])).toBe(true);
    expect(
      folderViolation("src/bus/registry", ["src/bus/registry/a.json", "src/bus/registry/a.config.ts"]),
    ).toBe(true);
    expect(folderViolation("src/bus/x", ["src/bus/x/y/y.module.ts"])).toBe(true);
  });
});

describe("folder role rule applies as specified", () => {
  it("accepts one file per role named after the module, in the root and in a sub-module", () => {
    expect(
      folderRoleViolations([
        "src/building/building.module.ts",
        "src/building/building.service.ts",
        "src/building/building.service.spec.ts",
        "src/building/building.document.ts",
        "src/building/sync/building-sync.module.ts",
        "src/building/sync/building-sync.service.ts",
        "src/building/sync/building-sync.document.generated.ts",
        "src/building/sync/building-sync.document.ts",
        "src/notices/notices.module.ts",
        "src/notices/notices.topics.ts",
        "src/notices/sources.json",
      ]),
    ).toEqual([]);
  });

  it("rejects a repeated role, a file named after another flow and a sub-module not named after its feature", () => {
    expect(
      folderRoleViolations([
        "src/building/building.module.ts",
        "src/building/building.mapper.ts",
        "src/building/building-sync.mapper.ts",
        "src/building/search/search.module.ts",
      ]),
    ).toEqual([
      "src/building/: mapper",
      "src/building/building-sync.mapper.ts: base",
      "src/building/search/search.module.ts: base",
    ]);
  });

  it("leaves shared roles and folders without a module to the other rules", () => {
    expect(
      folderRoleViolations(["src/http/a.middleware.ts", "src/http/b.middleware.ts", "src/bus/controllers/x.controller.ts", "src/bus/controllers/y.controller.ts"]),
    ).toEqual([]);
  });
});

describe("split-root rule applies as specified", () => {
  it("rejects a controller or poller at the root of a module that has a sub-module", () => {
    expect(
      splitRootViolations([
        "src/building/building.module.ts",
        "src/building/building.controller.ts",
        "src/building/building-sync.poller.ts",
        "src/building/search/building-search.module.ts",
        "src/building/search/building-search.controller.ts",
      ]),
    ).toEqual(["src/building/building-sync.poller.ts", "src/building/building.controller.ts"]);
  });

  it("leaves a single-flow module and a split module's flows alone", () => {
    expect(
      splitRootViolations([
        "src/health/health.module.ts",
        "src/health/health.controller.ts",
        "src/building/building.module.ts",
        "src/building/building.service.ts",
        "src/building/catalog/building-catalog.module.ts",
        "src/building/catalog/building-catalog.controller.ts",
        "src/building/sync/building-sync.module.ts",
        "src/building/sync/building-sync.poller.ts",
        "src/map/config/eskara-2026.json",
        "src/map/map.module.ts",
        "src/map/map-config.controller.ts",
      ]),
    ).toEqual([]);
  });
});

describe("top-level folder rule applies as specified", () => {
  it("accepts shared roles and feature modules, and rejects anything else", () => {
    expect(
      topLevelViolations([
        "src/main.ts",
        "src/http/app.error.ts",
        "src/building/building.module.ts",
        "src/building/building.service.ts",
        "src/foo/foo.service.ts",
        "src/app/app-feature.module.ts",
      ]),
    ).toEqual(["src/app/", "src/foo/"]);
  });
});

describe("src/ folders", () => {
  it("at the top level are shared roles or feature modules", () => {
    expectAllowlisted("top-level-folders", topLevelViolations(filesUnder("src")));
  });

  it("hold one file per role, named after their module", () => {
    expectAllowlisted("folder-roles", folderRoleViolations(filesUnder("src")));
  });

  it("keep no flow at the root of a module that has a sub-module", () => {
    expectAllowlisted("split-root", splitRootViolations(filesUnder("src")));
  });

  it("are sub-modules or JSON asset folders", () => {
    const files = filesUnder("src");
    const nested = dirsUnder("src").filter((d) => d.split("/").length > 2);
    expectAllowlisted(
      "folders",
      nested
        .filter((d) => folderViolation(d, files.filter((f) => f.startsWith(`${d}/`))))
        .map((d) => `${d}/`),
    );
  });
});
